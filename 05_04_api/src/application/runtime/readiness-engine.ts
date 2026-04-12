import { and, eq, inArray } from 'drizzle-orm'
import type { AppConfig } from '../../app/config'
import type { AppDatabase } from '../../db/client'
import { jobs, runClaims, runDependencies, runs } from '../../db/schema'
import { createRunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import { createToolExecutionRepository } from '../../domain/runtime/tool-execution-repository'
import type { DomainError } from '../../shared/errors'
import { asJobId, asRunId, asTenantId, asWorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { dependenciesSatisfiedForJob } from './job-dependencies'
import {
  isAutoExecutableQueuedRootJobReason,
  type ParsedJobQueueReason,
  parseJobQueueReason,
  type StaleRunRecoveryReason,
} from './job-status-reasons'
import { resolveExecutionScopeForSession } from './run-execution-scope'

export type RunRole = 'child' | 'root'

interface JobRunDecisionBase<TRunRole extends RunRole> {
  runRole: TRunRole
  runId: string
  sessionId: string
  tenantId: string
  jobId: string
}

type ExecutePendingRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'execute_pending_run'
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'execute_pending_run'
    })

type WaitingRunResumeReason = 'dependencies_satisfied' | 'process_restarted'

type ResumeWaitingRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'resume_waiting_run'
      resumeReason: WaitingRunResumeReason
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'resume_waiting_run'
      resumeReason: WaitingRunResumeReason
    })

type RequeueWaitingJobDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'requeue_waiting_job'
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'requeue_waiting_job'
    })

type RequeueStaleRunningRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'requeue_stale_running_run'
      lastProgressAt: string | null
      nextSchedulerCheckAt: string | null
      recoveryReason: StaleRunRecoveryReason
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'requeue_stale_running_run'
      lastProgressAt: string | null
      nextSchedulerCheckAt: string | null
      recoveryReason: StaleRunRecoveryReason
    })

type JobRunReadinessDecision =
  | ExecutePendingRunDecision
  | ResumeWaitingRunDecision
  | RequeueWaitingJobDecision
  | RequeueStaleRunningRunDecision

export type ReadinessDecision =
  | {
      childRunId: string
      kind: 'deliver_resolved_child_result'
      sessionId: string
      tenantId: string
    }
  | {
      kind: 'recover_timed_out_wait'
      runId: string
      sessionId: string
      tenantId: string
      timeoutAt: string | null
      waitId: string
    }
  | JobRunReadinessDecision

type ReadinessDecisionKind = ReadinessDecision['kind']
export type ReadinessDecisionMode = 'startup' | 'worker'
export interface ReadinessEngine {
  pickNextDecision: (input: {
    runRoles?: readonly RunRole[]
    kinds?: readonly ReadinessDecisionKind[]
    mode?: ReadinessDecisionMode
    now: string
    skipKeys?: ReadonlySet<string>
  }) => Result<ReadinessDecision | null, DomainError>
}

interface JobRunReadinessSnapshot {
  runRole: RunRole
  lastHeartbeatAt: string | null
  lastProgressAt: string | null
  leaseExpiresAt: string | null
  nextSchedulerCheckAt: string | null
  parentRunId: string | null
  priority: number
  queuedAt: string | null
  runCreatedAt: string
  runId: string
  runStatus: 'pending' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  sessionId: string
  queueReason: ParsedJobQueueReason | null
  tenantId: string
  jobId: string
  jobStatus: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'cancelled' | 'superseded'
  jobUpdatedAt: string
}

interface PendingWaitReadinessSnapshot {
  ownerRunId: string
  ownerRunStatus:
    | 'pending'
    | 'running'
    | 'cancelling'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
  sessionId: string
  targetRunId: string | null
  targetRunStatus:
    | 'pending'
    | 'running'
    | 'cancelling'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | null
  tenantId: string
  timeoutAt: string | null
  waitCreatedAt: string
  waitId: string
  waitTargetKind: string
  waitType: string
}

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

const decisionKey = (decision: ReadinessDecision): string => {
  switch (decision.kind) {
    case 'deliver_resolved_child_result':
      return `${decision.kind}:${decision.childRunId}`
    case 'recover_timed_out_wait':
      return `${decision.kind}:${decision.waitId}`
    default:
      return `${decision.kind}:${decision.jobId}:${decision.runId}`
  }
}

const firstUnskipped = (
  decisions: ReadinessDecision[],
  skipKeys: ReadonlySet<string>,
): ReadinessDecision | null => {
  for (const decision of decisions) {
    if (!skipKeys.has(decisionKey(decision))) {
      return decision
    }
  }

  return null
}

export const readinessDecisionKey = decisionKey

const matchesDecisionFilter = (
  decision: ReadinessDecision,
  input: {
    runRoles?: readonly RunRole[]
    kinds?: readonly ReadinessDecisionKind[]
  },
): boolean => {
  if (input.kinds && !input.kinds.includes(decision.kind)) {
    return false
  }

  if ('runRole' in decision && input.runRoles && !input.runRoles.includes(decision.runRole)) {
    return false
  }

  return true
}

const firstFilteredUnskipped = (
  decisions: ReadinessDecision[],
  input: {
    runRoles?: readonly RunRole[]
    kinds?: readonly ReadinessDecisionKind[]
    skipKeys: ReadonlySet<string>
  },
): ReadinessDecision | null =>
  firstUnskipped(
    decisions.filter((decision) => matchesDecisionFilter(decision, input)),
    input.skipKeys,
  )

const isHeartbeatPast = (value: string | null, threshold: string): boolean =>
  typeof value === 'string' && value.length > 0 && value <= threshold

const isDue = (value: string | null, now: string): boolean =>
  typeof value === 'string' && value.length > 0 && value <= now

const compareNullableAsc = (left: string | null, right: string | null): number => {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return -1
  }

  if (right === null) {
    return 1
  }

  return left.localeCompare(right)
}

const compareNumberAsc = (left: number, right: number): number => left - right

const compareStringAsc = (left: string, right: string): number => left.localeCompare(right)

const compareWaitingSnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareStringAsc(left.jobUpdatedAt, right.jobUpdatedAt) ||
  compareStringAsc(left.jobId, right.jobId)

const compareStaleSnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareNullableAsc(left.nextSchedulerCheckAt, right.nextSchedulerCheckAt) ||
  compareNullableAsc(left.lastHeartbeatAt, right.lastHeartbeatAt) ||
  compareNullableAsc(left.lastProgressAt, right.lastProgressAt) ||
  compareStringAsc(left.runId, right.runId)

const compareReadySnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareNumberAsc(left.priority, right.priority) ||
  compareNullableAsc(left.queuedAt, right.queuedAt) ||
  compareStringAsc(left.runCreatedAt, right.runCreatedAt) ||
  compareStringAsc(left.runId, right.runId)

const compareResolvedWaitSnapshots = (
  left: PendingWaitReadinessSnapshot,
  right: PendingWaitReadinessSnapshot,
): number =>
  compareStringAsc(left.waitCreatedAt, right.waitCreatedAt) ||
  compareStringAsc(left.waitId, right.waitId)

const compareTimedOutWaitSnapshots = (
  left: PendingWaitReadinessSnapshot,
  right: PendingWaitReadinessSnapshot,
): number =>
  compareNullableAsc(left.timeoutAt, right.timeoutAt) ||
  compareStringAsc(left.waitCreatedAt, right.waitCreatedAt) ||
  compareStringAsc(left.waitId, right.waitId)

export const createReadinessEngine = (input: {
  config: AppConfig
  db: AppDatabase
}): ReadinessEngine => {
  const runDependencyRepository = createRunDependencyRepository(input.db)

  const listPendingWaitReadinessDecisions = (
    now: string,
  ): Result<
    Array<
      Extract<
        ReadinessDecision,
        { kind: 'deliver_resolved_child_result' | 'recover_timed_out_wait' }
      >
    >,
    DomainError
  > => {
    try {
      const rows = input.db
        .select({
          ownerRunId: runs.id,
          ownerRunStatus: runs.status,
          sessionId: runs.sessionId,
          targetRunId: runDependencies.targetRunId,
          tenantId: runs.tenantId,
          timeoutAt: runDependencies.timeoutAt,
          waitCreatedAt: runDependencies.createdAt,
          waitId: runDependencies.id,
          waitTargetKind: runDependencies.targetKind,
          waitType: runDependencies.type,
        })
        .from(runDependencies)
        .innerJoin(
          runs,
          and(eq(runDependencies.runId, runs.id), eq(runDependencies.tenantId, runs.tenantId)),
        )
        .where(eq(runDependencies.status, 'pending'))
        .all()

      const snapshots = rows.map((row) => ({
        ownerRunId: row.ownerRunId,
        ownerRunStatus: row.ownerRunStatus,
        sessionId: row.sessionId,
        targetRunId: row.targetRunId,
        targetRunStatus: null,
        tenantId: row.tenantId,
        timeoutAt: row.timeoutAt,
        waitCreatedAt: row.waitCreatedAt,
        waitId: row.waitId,
        waitTargetKind: row.waitTargetKind,
        waitType: row.waitType,
      })) satisfies PendingWaitReadinessSnapshot[]

      const resolvedChildDeliveries: Array<{
        decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>
        snapshot: PendingWaitReadinessSnapshot
      }> = []
      const timedOutWaits: Array<{
        decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>
        snapshot: PendingWaitReadinessSnapshot
      }> = []
      const scopeCache = new Map<string, Result<TenantScope, DomainError>>()
      const targetRunStatusCache = new Map<string, Result<RunRecord['status'], DomainError>>()
      const targetRunDeliverableWaitCache = new Map<string, Result<boolean, DomainError>>()

      const getScope = (
        snapshot: PendingWaitReadinessSnapshot,
      ): Result<TenantScope, DomainError> => {
        const cacheKey = `${snapshot.tenantId}:${snapshot.sessionId}`
        const cached = scopeCache.get(cacheKey)

        if (cached) {
          return cached
        }

        const resolved = resolveExecutionScopeForSession(input.db, {
          sessionId: asWorkSessionId(snapshot.sessionId),
          tenantId: asTenantId(snapshot.tenantId),
        })

        scopeCache.set(cacheKey, resolved)

        return resolved
      }

      const getTargetRunStatus = (
        snapshot: PendingWaitReadinessSnapshot,
      ): Result<RunRecord['status'] | null, DomainError> => {
        if (!snapshot.targetRunId) {
          return ok(null)
        }

        const cached = targetRunStatusCache.get(snapshot.targetRunId)

        if (cached) {
          return cached
        }

        const scope = getScope(snapshot)

        if (!scope.ok) {
          return scope
        }

        const targetRun = createRunRepository(input.db).getById(
          scope.value,
          asRunId(snapshot.targetRunId),
        )
        const resolved = targetRun.ok ? ok(targetRun.value.status) : targetRun

        targetRunStatusCache.set(snapshot.targetRunId, resolved)

        return resolved
      }

      const targetRunHasDeliverablePendingWaits = (
        snapshot: PendingWaitReadinessSnapshot,
      ): Result<boolean, DomainError> => {
        if (!snapshot.targetRunId) {
          return ok(false)
        }

        const cached = targetRunDeliverableWaitCache.get(snapshot.targetRunId)

        if (cached) {
          return cached
        }

        const scope = getScope(snapshot)

        if (!scope.ok) {
          targetRunDeliverableWaitCache.set(snapshot.targetRunId, scope)
          return scope
        }

        const pendingWaits = runDependencyRepository.listPendingByRunId(
          scope.value,
          asRunId(snapshot.targetRunId),
        )
        const resolved = pendingWaits.ok
          ? ok(
              pendingWaits.value.some(
                (wait) => !(wait.type === 'agent' && wait.targetKind === 'run'),
              ),
            )
          : pendingWaits

        targetRunDeliverableWaitCache.set(snapshot.targetRunId, resolved)

        return resolved
      }

      for (const snapshot of snapshots) {
        if (
          snapshot.waitType === 'agent' &&
          snapshot.waitTargetKind === 'run' &&
          snapshot.targetRunId
        ) {
          const targetRunStatus = getTargetRunStatus(snapshot)

          if (!targetRunStatus.ok) {
            return targetRunStatus
          }

          if (
            targetRunStatus.value === 'completed' ||
            targetRunStatus.value === 'failed' ||
            targetRunStatus.value === 'cancelled'
          ) {
            resolvedChildDeliveries.push({
              decision: {
                childRunId: snapshot.targetRunId,
                kind: 'deliver_resolved_child_result',
                sessionId: snapshot.sessionId,
                tenantId: snapshot.tenantId,
              },
              snapshot,
            })
            continue
          }

          if (targetRunStatus.value === 'waiting') {
            const deliverablePendingWaits = targetRunHasDeliverablePendingWaits(snapshot)

            if (!deliverablePendingWaits.ok) {
              return deliverablePendingWaits
            }

            if (deliverablePendingWaits.value) {
              resolvedChildDeliveries.push({
                decision: {
                  childRunId: snapshot.targetRunId,
                  kind: 'deliver_resolved_child_result',
                  sessionId: snapshot.sessionId,
                  tenantId: snapshot.tenantId,
                },
                snapshot,
              })
              continue
            }
          }
        }

        if (snapshot.ownerRunStatus === 'waiting' && isDue(snapshot.timeoutAt, now)) {
          timedOutWaits.push({
            decision: {
              kind: 'recover_timed_out_wait',
              runId: snapshot.ownerRunId,
              sessionId: snapshot.sessionId,
              tenantId: snapshot.tenantId,
              timeoutAt: snapshot.timeoutAt,
              waitId: snapshot.waitId,
            },
            snapshot,
          })
        }
      }

      return ok([
        ...resolvedChildDeliveries
          .sort((left, right) => compareResolvedWaitSnapshots(left.snapshot, right.snapshot))
          .map((entry) => entry.decision),
        ...timedOutWaits
          .sort((left, right) => compareTimedOutWaitSnapshots(left.snapshot, right.snapshot))
          .map((entry) => entry.decision),
      ])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown pending wait readiness failure'

      return err({
        message: `failed to list pending-wait readiness decisions: ${message}`,
        type: 'conflict',
      })
    }
  }

  const listExecutionCapableJobSnapshots = (): Result<JobRunReadinessSnapshot[], DomainError> => {
    try {
      const rows = input.db
        .select({
          lastHeartbeatAt: jobs.lastHeartbeatAt,
          lastProgressAt: runs.lastProgressAt,
          leaseExpiresAt: runClaims.expiresAt,
          nextSchedulerCheckAt: jobs.nextSchedulerCheckAt,
          parentRunId: runs.parentRunId,
          priority: jobs.priority,
          queuedAt: jobs.queuedAt,
          runCreatedAt: runs.createdAt,
          runId: runs.id,
          runStatus: runs.status,
          sessionId: runs.sessionId,
          statusReasonJson: jobs.statusReasonJson,
          tenantId: runs.tenantId,
          jobId: jobs.id,
          jobStatus: jobs.status,
          jobUpdatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .innerJoin(runs, and(eq(jobs.currentRunId, runs.id), eq(jobs.tenantId, runs.tenantId)))
        .leftJoin(
          runClaims,
          and(eq(runClaims.runId, runs.id), eq(runClaims.tenantId, runs.tenantId)),
        )
        .where(
          and(
            inArray(jobs.status, ['queued', 'running', 'waiting']),
            inArray(runs.status, ['pending', 'running', 'waiting']),
          ),
        )
        .all()

      return ok(
        rows.map((row) => ({
          runRole: row.parentRunId ? 'child' : 'root',
          lastHeartbeatAt: row.lastHeartbeatAt,
          lastProgressAt: row.lastProgressAt,
          leaseExpiresAt: row.leaseExpiresAt,
          nextSchedulerCheckAt: row.nextSchedulerCheckAt,
          parentRunId: row.parentRunId,
          priority: row.priority,
          queuedAt: row.queuedAt,
          runCreatedAt: row.runCreatedAt,
          runId: row.runId,
          runStatus: row.runStatus,
          sessionId: row.sessionId,
          queueReason: parseJobQueueReason(row.statusReasonJson),
          tenantId: row.tenantId,
          jobId: row.jobId,
          jobStatus: row.jobStatus,
          jobUpdatedAt: row.jobUpdatedAt,
        })),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown work-item attempt readiness failure'

      return err({
        message: `failed to list work-item attempt readiness snapshots: ${message}`,
        type: 'conflict',
      })
    }
  }

  const listJobRunDecisions = (inputValue: {
    runRoles?: readonly RunRole[]
    kinds?: readonly JobRunReadinessDecision['kind'][]
    now: string
    resumeReason: WaitingRunResumeReason
    staleRunRecoveryReasons?: Partial<Record<RunRole, StaleRunRecoveryReason>>
  }): Result<JobRunReadinessDecision[], DomainError> => {
    const snapshots = listExecutionCapableJobSnapshots()

    if (!snapshots.ok) {
      return snapshots
    }

    const staleBefore = addMilliseconds(inputValue.now, -input.config.multiagent.leaseTtlMs)
    const scopeCache = new Map<string, Result<TenantScope, DomainError>>()
    const parentRunStatusCache = new Map<string, Result<RunRecord['status'], DomainError>>()
    const pendingWaitCountCache = new Map<string, Result<number, DomainError>>()
    const incompleteToolExecutionCountCache = new Map<string, Result<number, DomainError>>()
    const dependencySatisfiedCache = new Map<string, Result<boolean, DomainError>>()
    const allowedKinds = inputValue.kinds ? new Set(inputValue.kinds) : null
    const allowedRunRoles = inputValue.runRoles ? new Set(inputValue.runRoles) : null
    const staleRunRecoveryReasons = {
      child: inputValue.staleRunRecoveryReasons?.child ?? 'claim_expired',
      root: inputValue.staleRunRecoveryReasons?.root ?? 'claim_expired',
    } satisfies Record<RunRole, StaleRunRecoveryReason>

    const getScope = (snapshot: JobRunReadinessSnapshot): Result<TenantScope, DomainError> => {
      const cacheKey = `${snapshot.tenantId}:${snapshot.sessionId}`
      const cached = scopeCache.get(cacheKey)

      if (cached) {
        return cached
      }

      const resolved = resolveExecutionScopeForSession(input.db, {
        sessionId: asWorkSessionId(snapshot.sessionId),
        tenantId: asTenantId(snapshot.tenantId),
      })

      scopeCache.set(cacheKey, resolved)

      return resolved
    }

    const getPendingWaitCount = (
      snapshot: JobRunReadinessSnapshot,
    ): Result<number, DomainError> => {
      const cached = pendingWaitCountCache.get(snapshot.runId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        pendingWaitCountCache.set(snapshot.runId, scope)
        return scope
      }

      const pendingWaits = runDependencyRepository.listPendingByRunId(
        scope.value,
        asRunId(snapshot.runId),
      )
      const counted = pendingWaits.ok ? ok(pendingWaits.value.length) : pendingWaits
      pendingWaitCountCache.set(snapshot.runId, counted)

      return counted
    }

    const getIncompleteToolExecutionCount = (
      snapshot: JobRunReadinessSnapshot,
    ): Result<number, DomainError> => {
      const cached = incompleteToolExecutionCountCache.get(snapshot.runId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        incompleteToolExecutionCountCache.set(snapshot.runId, scope)
        return scope
      }

      const incompleteToolExecutions = createToolExecutionRepository(
        input.db,
      ).listIncompleteByRunId(scope.value, asRunId(snapshot.runId))
      const counted = incompleteToolExecutions.ok
        ? ok(incompleteToolExecutions.value.length)
        : incompleteToolExecutions
      incompleteToolExecutionCountCache.set(snapshot.runId, counted)

      return counted
    }

    const getParentRunStatus = (
      snapshot: JobRunReadinessSnapshot,
    ): Result<RunRecord['status'] | null, DomainError> => {
      if (!snapshot.parentRunId) {
        return ok(null)
      }

      const cached = parentRunStatusCache.get(snapshot.parentRunId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        return scope
      }

      const parentRun = createRunRepository(input.db).getById(
        scope.value,
        asRunId(snapshot.parentRunId),
      )
      const resolved = parentRun.ok ? ok(parentRun.value.status) : parentRun
      parentRunStatusCache.set(snapshot.parentRunId, resolved)

      return resolved
    }

    const dependenciesSatisfied = (
      snapshot: JobRunReadinessSnapshot,
    ): Result<boolean, DomainError> => {
      const cached = dependencySatisfiedCache.get(snapshot.jobId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        dependencySatisfiedCache.set(snapshot.jobId, scope)
        return scope
      }

      const evaluated = dependenciesSatisfiedForJob(input.db, scope.value, asJobId(snapshot.jobId))

      dependencySatisfiedCache.set(snapshot.jobId, evaluated)

      return evaluated
    }

    const matchesFilter = (decision: JobRunReadinessDecision): boolean =>
      (!allowedKinds || allowedKinds.has(decision.kind)) &&
      (!allowedRunRoles || allowedRunRoles.has(decision.runRole))

    const decisionGroups = {
      pendingChildren: [] as Array<{
        decision: Extract<
          JobRunReadinessDecision,
          { runRole: 'child'; kind: 'execute_pending_run' }
        >
        snapshot: JobRunReadinessSnapshot
      }>,
      pendingRoots: [] as Array<{
        decision: Extract<JobRunReadinessDecision, { runRole: 'root'; kind: 'execute_pending_run' }>
        snapshot: JobRunReadinessSnapshot
      }>,
      reopenable: [] as Array<{
        decision: Extract<JobRunReadinessDecision, { kind: 'requeue_waiting_job' }>
        snapshot: JobRunReadinessSnapshot
      }>,
      resumable: [] as Array<{
        decision: Extract<JobRunReadinessDecision, { kind: 'resume_waiting_run' }>
        snapshot: JobRunReadinessSnapshot
      }>,
      staleChildren: [] as Array<{
        decision: Extract<
          JobRunReadinessDecision,
          { runRole: 'child'; kind: 'requeue_stale_running_run' }
        >
        snapshot: JobRunReadinessSnapshot
      }>,
      staleRoots: [] as Array<{
        decision: Extract<
          JobRunReadinessDecision,
          { runRole: 'root'; kind: 'requeue_stale_running_run' }
        >
        snapshot: JobRunReadinessSnapshot
      }>,
    }

    const evaluateSnapshot = (snapshot: JobRunReadinessSnapshot): Result<null, DomainError> => {
      if (snapshot.runStatus === 'waiting') {
        const pendingWaitCount = getPendingWaitCount(snapshot)

        if (!pendingWaitCount.ok) {
          return pendingWaitCount
        }

        if (pendingWaitCount.value > 0) {
          return ok(null)
        }

        const incompleteToolExecutionCount = getIncompleteToolExecutionCount(snapshot)

        if (!incompleteToolExecutionCount.ok) {
          return incompleteToolExecutionCount
        }

        if (incompleteToolExecutionCount.value > 0) {
          return ok(null)
        }

        if (snapshot.jobStatus === 'waiting') {
          const dependencies = dependenciesSatisfied(snapshot)

          if (!dependencies.ok) {
            return dependencies
          }

          if (!dependencies.value) {
            return ok(null)
          }

          const decision = {
            runRole: snapshot.runRole,
            kind: 'requeue_waiting_job' as const,
            runId: snapshot.runId,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
            jobId: snapshot.jobId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.reopenable.push({ decision, snapshot })
          }

          return ok(null)
        }

        if (snapshot.jobStatus === 'queued') {
          const decision = {
            runRole: snapshot.runRole,
            kind: 'resume_waiting_run' as const,
            resumeReason: inputValue.resumeReason,
            runId: snapshot.runId,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
            jobId: snapshot.jobId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.resumable.push({ decision, snapshot })
          }
        }

        return ok(null)
      }

      if (snapshot.runStatus === 'running' && snapshot.jobStatus === 'running') {
        const leaseExpired =
          snapshot.leaseExpiresAt === null || snapshot.leaseExpiresAt <= inputValue.now
        const stale =
          isDue(snapshot.nextSchedulerCheckAt, inputValue.now) ||
          isHeartbeatPast(snapshot.lastHeartbeatAt ?? snapshot.lastProgressAt, staleBefore)

        if (leaseExpired && stale) {
          const recoveryReason = staleRunRecoveryReasons[snapshot.runRole]

          if (snapshot.runRole === 'root') {
            const decision = {
              runRole: 'root' as const,
              kind: 'requeue_stale_running_run' as const,
              lastProgressAt: snapshot.lastProgressAt,
              nextSchedulerCheckAt: snapshot.nextSchedulerCheckAt,
              recoveryReason,
              runId: snapshot.runId,
              sessionId: snapshot.sessionId,
              tenantId: snapshot.tenantId,
              jobId: snapshot.jobId,
            }

            if (matchesFilter(decision)) {
              decisionGroups.staleRoots.push({ decision, snapshot })
            }
          } else {
            const decision = {
              runRole: 'child' as const,
              kind: 'requeue_stale_running_run' as const,
              lastProgressAt: snapshot.lastProgressAt,
              nextSchedulerCheckAt: snapshot.nextSchedulerCheckAt,
              recoveryReason,
              runId: snapshot.runId,
              sessionId: snapshot.sessionId,
              tenantId: snapshot.tenantId,
              jobId: snapshot.jobId,
            }

            if (matchesFilter(decision)) {
              decisionGroups.staleChildren.push({ decision, snapshot })
            }
          }
        }

        return ok(null)
      }

      if (snapshot.runStatus === 'pending' && snapshot.jobStatus === 'queued') {
        if (snapshot.nextSchedulerCheckAt && !isDue(snapshot.nextSchedulerCheckAt, inputValue.now)) {
          return ok(null)
        }

        if (
          snapshot.runRole === 'root' &&
          !isAutoExecutableQueuedRootJobReason(snapshot.queueReason)
        ) {
          return ok(null)
        }

        if (snapshot.runRole === 'child') {
          const parentRunStatus = getParentRunStatus(snapshot)

          if (!parentRunStatus.ok) {
            return parentRunStatus
          }

          if (parentRunStatus.value === 'pending' || parentRunStatus.value === 'running') {
            return ok(null)
          }
        }

        if (snapshot.runRole === 'root') {
          const decision = {
            runRole: 'root' as const,
            kind: 'execute_pending_run' as const,
            runId: snapshot.runId,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
            jobId: snapshot.jobId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.pendingRoots.push({ decision, snapshot })
          }
        } else {
          const decision = {
            runRole: 'child' as const,
            kind: 'execute_pending_run' as const,
            runId: snapshot.runId,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
            jobId: snapshot.jobId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.pendingChildren.push({ decision, snapshot })
          }
        }
      }

      return ok(null)
    }

    for (const snapshot of snapshots.value) {
      const evaluated = evaluateSnapshot(snapshot)

      if (!evaluated.ok) {
        return evaluated
      }
    }

    const ordered = [
      ...decisionGroups.reopenable.sort((left, right) =>
        compareWaitingSnapshots(left.snapshot, right.snapshot),
      ),
      ...decisionGroups.resumable.sort((left, right) =>
        compareWaitingSnapshots(left.snapshot, right.snapshot),
      ),
      ...decisionGroups.staleRoots.sort((left, right) =>
        compareStaleSnapshots(left.snapshot, right.snapshot),
      ),
      ...decisionGroups.staleChildren.sort((left, right) =>
        compareStaleSnapshots(left.snapshot, right.snapshot),
      ),
      ...decisionGroups.pendingRoots.sort((left, right) =>
        compareReadySnapshots(left.snapshot, right.snapshot),
      ),
      ...decisionGroups.pendingChildren.sort((left, right) =>
        compareReadySnapshots(left.snapshot, right.snapshot),
      ),
    ]

    return ok(ordered.map((entry) => entry.decision))
  }

  const listDueDecisions = (inputValue: {
    mode?: ReadinessDecisionMode
    now: string
  }): Result<ReadinessDecision[], DomainError> => {
    const ancillaryDecisions = listPendingWaitReadinessDecisions(inputValue.now)

    if (!ancillaryDecisions.ok) {
      return ancillaryDecisions
    }

    const jobDecisions =
      (inputValue.mode ?? 'worker') === 'startup'
        ? listJobRunDecisions({
            runRoles: undefined,
            kinds: ['requeue_waiting_job', 'resume_waiting_run', 'requeue_stale_running_run'],
            now: inputValue.now,
            resumeReason: 'process_restarted',
            staleRunRecoveryReasons: {
              child: 'claim_expired',
              root: 'process_restarted',
            },
          })
        : listJobRunDecisions({
            now: inputValue.now,
            resumeReason: 'dependencies_satisfied',
          })

    if (!jobDecisions.ok) {
      return jobDecisions
    }

    return ok([...ancillaryDecisions.value, ...jobDecisions.value])
  }

  return {
    pickNextDecision: (inputValue: {
      runRoles?: readonly RunRole[]
      kinds?: readonly ReadinessDecisionKind[]
      mode?: ReadinessDecisionMode
      now: string
      skipKeys?: ReadonlySet<string>
    }): Result<ReadinessDecision | null, DomainError> => {
      const skipKeys = inputValue.skipKeys ?? new Set<string>()
      const dueDecisions = listDueDecisions({
        mode: inputValue.mode,
        now: inputValue.now,
      })

      if (!dueDecisions.ok) {
        return dueDecisions
      }

      const decision = firstFilteredUnskipped(dueDecisions.value, {
        runRoles: inputValue.runRoles,
        kinds: inputValue.kinds,
        skipKeys,
      })

      if (decision) {
        return ok(decision)
      }

      return ok(null)
    },
  }
}
