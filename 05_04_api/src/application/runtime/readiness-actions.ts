import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import { withTransaction } from '../../db/transaction'
import { createRunClaimRepository } from '../../domain/runtime/run-claim-repository'
import { createRunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import { createRunRepository } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { asRunId, asTenantId, asWorkSessionId } from '../../shared/ids'
import type { AppLogger } from '../../shared/logger'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createEventStore } from '../commands/event-store'
import { createInternalCommandContext } from '../commands/internal-command-context'
import { deliverChildResultToParentWaits } from './child-run-delivery'
import { executeRunTurnLoop } from './drive-run'
import type { StaleRunRecoveryReason } from './job-status-reasons'
import { appendRunEvent } from './run-events'
import {
  markLinkedJobRunning,
  markRunJobBlocked,
  queueLinkedJob,
  recordLinkedJobHeartbeat,
} from './job-sync'
import type { ReadinessDecision, RunRole } from './readiness-engine'
import { resolveExecutionScopeForSession } from './run-execution-scope'
import { resolveRunWait } from './run-wait-resolution'

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

type RunScopedDecision = Extract<
  ReadinessDecision,
  {
    runId: string
    sessionId: string
    tenantId: string
  }
>

export interface ReadinessActions {
  deliverResolvedChildResult: (
    decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>,
  ) => Promise<boolean>
  executePendingRun: (
    decision: Extract<ReadinessDecision, { kind: 'execute_pending_run' }>,
  ) => Promise<boolean>
  processDecision: (decision: ReadinessDecision) => Promise<boolean>
  recoverTimedOutWait: (
    decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>,
  ) => Promise<boolean>
  requeueWaitingJob: (
    decision: Extract<ReadinessDecision, { kind: 'requeue_waiting_job' }>,
  ) => Promise<boolean>
  requeueStaleRunningRun: (
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>,
  ) => Promise<boolean>
  resumeRunAfterWaits: (
    decision: Extract<ReadinessDecision, { kind: 'resume_waiting_run' }>,
  ) => Promise<boolean>
}

export const createReadinessActions = (input: {
  config: AppConfig
  db: AppDatabase
  logger: AppLogger
  services: AppServices
  workerId: string
}): ReadinessActions => {
  const runRepository = createRunRepository(input.db)
  const runDependencyRepository = createRunDependencyRepository(input.db)
  const claimHeartbeatIntervalMs = Math.max(25, Math.floor(input.config.multiagent.leaseTtlMs / 3))
  const waitTimeoutMessage = 'Wait timed out before external input arrived'

  const matchesRunRole = (run: Pick<RunRecord, 'parentRunId'>, runRole: RunRole): boolean =>
    runRole === 'root' ? run.parentRunId === null : run.parentRunId !== null

  const toRunRoleLabel = (runRole: RunRole): 'Child' | 'Root' =>
    runRole === 'root' ? 'Root' : 'Child'

  const toRecoveryLogLabel = (reason: StaleRunRecoveryReason): string =>
    reason === 'process_restarted' ? 'process restart' : 'expired claim'

  const staleRecoveryDelayMs = (staleRecoveryCount: number): number => {
    if (staleRecoveryCount <= 1) {
      return 0
    }

    return input.config.multiagent.staleRecoveryBaseDelayMs * 2 ** (staleRecoveryCount - 2)
  }

  const nextStaleRecoveryCheckAt = (
    updatedAt: string,
    staleRecoveryCount: number,
  ): string | null => {
    const delayMs = staleRecoveryDelayMs(staleRecoveryCount)

    return delayMs > 0 ? addMilliseconds(updatedAt, delayMs) : null
  }

  const failStaleRunningRun = async (inputValue: {
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>
    run: RunRecord
    scope: TenantScope
  }): Promise<boolean> => {
    const failedAt = input.services.clock.nowIso()
    const context = createInternalCommandContext(input, inputValue.scope)
    const error = {
      message: `run ${inputValue.run.id} exceeded the configured maximum of ${input.config.multiagent.maxStaleRecoveries} stale recovery attempts`,
      type: 'timeout' as const,
    }
    const failed = withTransaction(input.db, (tx) => {
      const txRunRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const failedRun = txRunRepository.fail(inputValue.scope, {
        completedAt: failedAt,
        errorJson: error,
        expectedStatus: 'running',
        expectedVersion: inputValue.run.version,
        lastProgressAt: failedAt,
        resultJson: inputValue.run.resultJson ?? null,
        runId: inputValue.run.id,
        turnCount: inputValue.run.turnCount,
        updatedAt: failedAt,
      })

      if (!failedRun.ok) {
        return failedRun
      }

      appendRunEvent(context, eventStore, failedRun.value, 'run.failed', {
        error,
      })

      const blocked = markRunJobBlocked(tx, inputValue.scope, failedRun.value, {
        eventContext: {
          eventStore,
          traceId: context.traceId,
        },
        error,
        updatedAt: failedAt,
      })

      if (!blocked.ok) {
        return blocked
      }

      return ok(failedRun.value)
    })

    if (!failed.ok) {
      input.logger.warn(`Failed to stop stale ${inputValue.decision.runRole} run after recovery limit`, {
        message: failed.error.message,
        runId: inputValue.decision.runId,
        tenantId: inputValue.decision.tenantId,
      })
      return false
    }

    input.logger.warn(
      `Stopped stale ${inputValue.decision.runRole} run after exhausting recovery attempts`,
      {
        recoveryReason: inputValue.decision.recoveryReason,
        runId: inputValue.decision.runId,
        staleRecoveryCount: inputValue.run.staleRecoveryCount,
        tenantId: inputValue.decision.tenantId,
      },
    )

    return true
  }

  const resolveDecisionScope = (decision: Pick<RunScopedDecision, 'sessionId' | 'tenantId'>) =>
    resolveExecutionScopeForSession(input.db, {
      sessionId: asWorkSessionId(decision.sessionId),
      tenantId: asTenantId(decision.tenantId),
    })

  const loadRunTarget = (inputValue: {
    expectedRunRole?: RunRole
    expectedStatuses?: readonly RunRecord['status'][]
    runId: string
    sessionId: string
    tenantId: string
  }): Result<
    | {
        run: RunRecord
        scope: TenantScope
        status: 'loaded'
      }
    | {
        status: 'missing'
      },
    DomainError
  > => {
    const scope = resolveDecisionScope(inputValue)

    if (!scope.ok) {
      return scope
    }

    const run = runRepository.getById(scope.value, asRunId(inputValue.runId))

    if (!run.ok) {
      return ok({
        status: 'missing',
      })
    }

    if (inputValue.expectedStatuses && !inputValue.expectedStatuses.includes(run.value.status)) {
      return ok({
        status: 'missing',
      })
    }

    if (inputValue.expectedRunRole && !matchesRunRole(run.value, inputValue.expectedRunRole)) {
      return ok({
        status: 'missing',
      })
    }

    return ok({
      run: run.value,
      scope: scope.value,
      status: 'loaded',
    })
  }

  const withRunTarget = async (inputValue: {
    execute: (context: { run: RunRecord; scope: TenantScope }) => Promise<boolean>
    logLoadFailure?: {
      message: string
      runId: string
      runIdField?: 'childRunId' | 'runId'
      tenantId: string
    }
    logScopeFailure: {
      message: string
      runId: string
      runIdField?: 'childRunId' | 'runId'
      tenantId: string
    }
    target: {
      expectedRunRole?: RunRole
      expectedStatuses?: readonly RunRecord['status'][]
      runId: string
      sessionId: string
      tenantId: string
    }
  }): Promise<boolean> => {
    const loaded = loadRunTarget({
      expectedRunRole: inputValue.target.expectedRunRole,
      expectedStatuses: inputValue.target.expectedStatuses,
      runId: inputValue.target.runId,
      sessionId: inputValue.target.sessionId,
      tenantId: inputValue.target.tenantId,
    })

    if (!loaded.ok) {
      input.logger.warn(inputValue.logScopeFailure.message, {
        message: loaded.error.message,
        [inputValue.logScopeFailure.runIdField ?? 'runId']: inputValue.logScopeFailure.runId,
        tenantId: inputValue.logScopeFailure.tenantId,
      })
      return false
    }

    if (loaded.value.status === 'missing') {
      if (inputValue.logLoadFailure) {
        input.logger.warn(inputValue.logLoadFailure.message, {
          [inputValue.logLoadFailure.runIdField ?? 'runId']: inputValue.logLoadFailure.runId,
          tenantId: inputValue.logLoadFailure.tenantId,
        })
      }

      return false
    }

    return inputValue.execute({
      run: loaded.value.run,
      scope: loaded.value.scope,
    })
  }

  const listPendingWaitsForRun = (scope: TenantScope, runId: RunRecord['id']) =>
    runDependencyRepository.listPendingByRunId(scope, runId)

  const syncClaimHeartbeat = (scope: TenantScope, run: RunRecord, heartbeatAt: string) => {
    const synced = recordLinkedJobHeartbeat(input.db, scope, run, {
      heartbeatAt,
      nextSchedulerCheckAt: addMilliseconds(heartbeatAt, input.config.multiagent.leaseTtlMs),
    })

    if (!synced.ok) {
      input.logger.warn('Failed to record job heartbeat from a run claim heartbeat', {
        message: synced.error.message,
        runId: run.id,
        tenantId: scope.tenantId,
      })
    }
  }

  const claimRunAndExecute = async (inputValue: {
    runRole: RunRole
    event: {
      payload: Record<string, unknown>
      type: 'run.resumed' | 'run.started'
    }
    expectedStatus: 'pending' | 'waiting'
    failureLogMessage: string
    run: RunRecord
    scope: TenantScope
  }): Promise<boolean> => {
    const claimedAt = input.services.clock.nowIso()
    const claimRepository = createRunClaimRepository(input.db)
    const claim = claimRepository.claim(inputValue.scope, {
      acquiredAt: claimedAt,
      expiresAt: addMilliseconds(claimedAt, input.config.multiagent.leaseTtlMs),
      renewedAt: claimedAt,
      runId: inputValue.run.id,
      workerId: input.workerId,
    })

    if (!claim.ok) {
      return false
    }

    syncClaimHeartbeat(inputValue.scope, inputValue.run, claimedAt)

    const heartbeat = setInterval(() => {
      const renewedAt = input.services.clock.nowIso()
      const renewed = claimRepository.heartbeatClaim(inputValue.scope, {
        expiresAt: addMilliseconds(renewedAt, input.config.multiagent.leaseTtlMs),
        renewedAt,
        runId: inputValue.run.id,
        workerId: input.workerId,
      })

      if (!renewed.ok) {
        input.logger.warn(`Failed to heartbeat ${inputValue.runRole} run claim`, {
          message: renewed.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
          workerId: input.workerId,
        })
        return
      }

      syncClaimHeartbeat(inputValue.scope, inputValue.run, renewedAt)
    }, claimHeartbeatIntervalMs)

    try {
      const runningAt = input.services.clock.nowIso()
      const runningRun = withTransaction(input.db, (tx) => {
        const txRunRepository = createRunRepository(tx)
        const eventStore = createEventStore(tx)
        const updatedRun = txRunRepository.markRunning(inputValue.scope, {
          configSnapshot: inputValue.run.configSnapshot,
          expectedStatus: inputValue.expectedStatus,
          expectedVersion: inputValue.run.version,
          lastProgressAt: runningAt,
          runId: inputValue.run.id,
          startedAt: inputValue.run.startedAt ?? runningAt,
          updatedAt: runningAt,
        })

        if (!updatedRun.ok) {
          return updatedRun
        }

        const appended = eventStore.append({
          actorAccountId: inputValue.scope.accountId,
          aggregateId: inputValue.run.id,
          aggregateType: 'run',
          payload: inputValue.event.payload,
          tenantId: inputValue.scope.tenantId,
          type: inputValue.event.type,
        })

        if (!appended.ok) {
          return appended
        }

        const syncedJob = markLinkedJobRunning(tx, inputValue.scope, updatedRun.value, runningAt)

        if (!syncedJob.ok) {
          return syncedJob
        }

        return ok(updatedRun.value)
      })

      if (!runningRun.ok) {
        input.logger.warn(inputValue.failureLogMessage, {
          message: runningRun.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
        })
        return false
      }

      const execution = await executeRunTurnLoop(
        createInternalCommandContext(input, inputValue.scope),
        runningRun.value,
        {},
      )

      if (!execution.ok) {
        input.logger.warn(`${toRunRoleLabel(inputValue.runRole)} run execution returned an error`, {
          message: execution.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
          type: execution.error.type,
        })
      }
    } finally {
      clearInterval(heartbeat)
      const released = claimRepository.releaseClaim(inputValue.scope, {
        runId: inputValue.run.id,
        workerId: input.workerId,
      })

      if (!released.ok) {
        input.logger.warn(`Failed to release ${inputValue.runRole} run claim`, {
          message: released.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
        })
      }
    }

    return true
  }

  const executePendingRun = async (
    decision: Extract<ReadinessDecision, { kind: 'execute_pending_run' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: ({ run, scope }) =>
        claimRunAndExecute({
          runRole: decision.runRole,
          event: {
            payload: {
              ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
              ...(run.sourceCallId ? { sourceCallId: run.sourceCallId } : {}),
              rootRunId: run.rootRunId,
              runId: run.id,
              sessionId: run.sessionId,
              status: 'running',
              targetKind: run.targetKind,
              task: run.task,
              threadId: run.threadId,
            },
            type: 'run.started',
          },
          expectedStatus: 'pending',
          failureLogMessage: `${toRunRoleLabel(decision.runRole)} run failed to transition from pending to running`,
          run,
          scope,
        }),
      logScopeFailure: {
        message: 'Failed to resolve pending run execution scope',
        runId: decision.runId,
        tenantId: decision.tenantId,
      },
      target: {
        expectedRunRole: decision.runRole,
        expectedStatuses: ['pending'],
        runId: decision.runId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  const resumeRunAfterWaits = async (
    decision: Extract<ReadinessDecision, { kind: 'resume_waiting_run' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: async ({ run, scope }) => {
        const pendingWaits = listPendingWaitsForRun(scope, run.id)

        if (!pendingWaits.ok) {
          input.logger.warn('Failed to inspect recovered waiting run before execution', {
            message: pendingWaits.error.message,
            runId: decision.runId,
            tenantId: decision.tenantId,
          })
          return false
        }

        if (pendingWaits.value.length > 0) {
          return false
        }

        return claimRunAndExecute({
          runRole: decision.runRole,
          event: {
            payload: {
              ...(decision.resumeReason === 'process_restarted'
                ? {
                    reason: 'process_restarted',
                    recoveredFromStatus: 'waiting',
                  }
                : {
                    reason: 'dependencies_satisfied',
                  }),
              ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
              ...(run.sourceCallId ? { sourceCallId: run.sourceCallId } : {}),
              rootRunId: run.rootRunId,
              runId: run.id,
              sessionId: run.sessionId,
              status: 'running',
              targetKind: run.targetKind,
              task: run.task,
              threadId: run.threadId,
            },
            type: 'run.resumed',
          },
          expectedStatus: 'waiting',
          failureLogMessage:
            decision.resumeReason === 'process_restarted'
              ? 'Failed to resume recovered waiting run'
              : 'Failed to resume waiting run after dependencies were satisfied',
          run,
          scope,
        })
      },
      logScopeFailure: {
        message: 'Failed to resolve recovered waiting run scope',
        runId: decision.runId,
        tenantId: decision.tenantId,
      },
      target: {
        expectedStatuses: ['waiting'],
        runId: decision.runId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  const requeueWaitingJob = async (
    decision: Extract<ReadinessDecision, { kind: 'requeue_waiting_job' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: async ({ run, scope }) => {
        const pendingWaits = listPendingWaitsForRun(scope, run.id)

        if (!pendingWaits.ok || pendingWaits.value.length > 0) {
          return false
        }

        const reopenedAt = input.services.clock.nowIso()
        const reopened = withTransaction(input.db, (tx) => {
          const eventStore = createEventStore(tx)
          const syncedJob = queueLinkedJob(tx, scope, run, {
            eventContext: {
              eventStore,
            },
            reason: 'dependencies_satisfied',
            updatedAt: reopenedAt,
          })

          if (!syncedJob.ok) {
            return syncedJob
          }

          return ok(null)
        })

        if (!reopened.ok) {
          input.logger.warn('Failed to requeue waiting job', {
            message: reopened.error.message,
            runId: decision.runId,
            tenantId: decision.tenantId,
          })
          return false
        }

        return true
      },
      logScopeFailure: {
        message: 'Failed to resolve waiting job requeue scope',
        runId: decision.runId,
        tenantId: decision.tenantId,
      },
      target: {
        expectedStatuses: ['waiting'],
        runId: decision.runId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  const requeueStaleRunningRun = async (
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: async ({ run, scope }) => {
        if (
          decision.recoveryReason === 'claim_expired' &&
          run.staleRecoveryCount >= input.config.multiagent.maxStaleRecoveries
        ) {
          return failStaleRunningRun({
            decision,
            run,
            scope,
          })
        }

        const requeuedAt = input.services.clock.nowIso()
        const nextStaleRecoveryCount =
          decision.recoveryReason === 'claim_expired'
            ? run.staleRecoveryCount + 1
            : run.staleRecoveryCount
        const nextSchedulerCheckAt =
          decision.recoveryReason === 'claim_expired'
            ? nextStaleRecoveryCheckAt(requeuedAt, nextStaleRecoveryCount)
            : null
        const requeued = withTransaction(input.db, (tx) => {
          const txRunRepository = createRunRepository(tx)
          const eventStore = createEventStore(tx)
          const updatedRun = txRunRepository.markPending(scope, {
            expectedStatus: 'running',
            expectedVersion: run.version,
            lastProgressAt: requeuedAt,
            resultJson: run.resultJson,
            runId: run.id,
            staleRecoveryCount: nextStaleRecoveryCount,
            updatedAt: requeuedAt,
          })

          if (!updatedRun.ok) {
            return updatedRun
          }

          const appended = eventStore.append({
            actorAccountId: scope.accountId,
            aggregateId: run.id,
            aggregateType: 'run',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              reason: decision.recoveryReason,
              recoveredFromStatus: 'running',
              runId: updatedRun.value.id,
              sessionId: updatedRun.value.sessionId,
              status: updatedRun.value.status,
              threadId: updatedRun.value.threadId,
            },
            tenantId: scope.tenantId,
            type: 'run.requeued',
          })

          if (!appended.ok) {
            return appended
          }

          const syncedJob = queueLinkedJob(tx, scope, updatedRun.value, {
            eventContext: {
              eventStore,
            },
            nextSchedulerCheckAt,
            reason: decision.recoveryReason,
            updatedAt: requeuedAt,
          })

          if (!syncedJob.ok) {
            return syncedJob
          }

          return ok(updatedRun.value)
        })

        if (!requeued.ok) {
          input.logger.warn(`Failed to requeue stale running ${decision.runRole} run`, {
            message: requeued.error.message,
            runId: decision.runId,
            tenantId: decision.tenantId,
          })
          return false
        }

        input.logger.warn(
          `Requeued ${decision.runRole} run for recovery after ${toRecoveryLogLabel(decision.recoveryReason)}`,
          {
            lastProgressAt: decision.lastProgressAt,
            ...(nextSchedulerCheckAt ? { nextSchedulerCheckAt } : {}),
            reason: decision.recoveryReason,
            runId: decision.runId,
            staleRecoveryCount: nextStaleRecoveryCount,
            tenantId: decision.tenantId,
          },
        )

        return true
      },
      logScopeFailure: {
        message: `Failed to requeue stale running ${decision.runRole} run`,
        runId: decision.runId,
        tenantId: decision.tenantId,
      },
      target: {
        expectedRunRole: decision.runRole,
        expectedStatuses: ['running'],
        runId: decision.runId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  const deliverResolvedChildResult = async (
    decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: async ({ run, scope }) => {
        const delivered = await deliverChildResultToParentWaits(
          createInternalCommandContext(input, scope),
          run,
        )

        if (!delivered.ok) {
          input.logger.warn('Failed to deliver child run update to parent wait', {
            childRunId: decision.childRunId,
            message: delivered.error.message,
            tenantId: decision.tenantId,
          })
          return false
        }

        return delivered.value.deliveredWaitIds.length > 0
      },
      logLoadFailure: {
        message: 'Failed to load child run for parent update delivery',
        runId: decision.childRunId,
        runIdField: 'childRunId',
        tenantId: decision.tenantId,
      },
      logScopeFailure: {
        message: 'Failed to resolve child run update delivery scope',
        runId: decision.childRunId,
        runIdField: 'childRunId',
        tenantId: decision.tenantId,
      },
      target: {
        expectedRunRole: 'child',
        expectedStatuses: ['completed', 'failed', 'cancelled', 'waiting'],
        runId: decision.childRunId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  const recoverTimedOutWait = async (
    decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>,
  ): Promise<boolean> =>
    withRunTarget({
      execute: async ({ run, scope }) => {
        const timedOut = await resolveRunWait(createInternalCommandContext(input, scope), run.id, {
          error: {
            message: waitTimeoutMessage,
            type: 'timeout',
          },
          waitId: decision.waitId,
          waitResolution: {
            resolutionJson: {
              error: waitTimeoutMessage,
              timeoutAt: decision.timeoutAt,
            },
            status: 'timed_out',
          },
        })

        if (timedOut.ok) {
          return true
        }

        const runDependency = runDependencyRepository.getById(scope, decision.waitId)

        if (runDependency.ok && runDependency.value.status !== 'pending') {
          return true
        }

        input.logger.warn('Failed to recover timed-out wait', {
          message: timedOut.error.message,
          runId: decision.runId,
          tenantId: decision.tenantId,
          waitId: decision.waitId,
        })

        return false
      },
      logScopeFailure: {
        message: 'Failed to resolve timed-out wait recovery scope',
        runId: decision.runId,
        tenantId: decision.tenantId,
      },
      target: {
        expectedStatuses: ['waiting'],
        runId: decision.runId,
        sessionId: decision.sessionId,
        tenantId: decision.tenantId,
      },
    })

  return {
    deliverResolvedChildResult,
    executePendingRun,
    processDecision: async (decision) => {
      switch (decision.kind) {
        case 'deliver_resolved_child_result':
          return deliverResolvedChildResult(decision)
        case 'recover_timed_out_wait':
          return recoverTimedOutWait(decision)
        case 'requeue_waiting_job':
          return requeueWaitingJob(decision)
        case 'resume_waiting_run':
          return resumeRunAfterWaits(decision)
        case 'requeue_stale_running_run':
          return requeueStaleRunningRun(decision)
        case 'execute_pending_run':
          return executePendingRun(decision)
      }
    },
    recoverTimedOutWait,
    requeueWaitingJob,
    requeueStaleRunningRun,
    resumeRunAfterWaits,
  }
}
