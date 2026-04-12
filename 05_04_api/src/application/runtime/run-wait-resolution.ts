import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../adapters/mcp/normalize-tool'
import { withTransaction } from '../../db/transaction'
import { toChildRunReplayOutput } from '../../domain/agents/agent-types'
import { createMcpToolAssignmentRepository } from '../../domain/mcp/mcp-tool-assignment-repository'
import { createItemRepository } from '../../domain/runtime/item-repository'
import {
  createRunDependencyRepository,
  type RunDependencyRecord,
  type RunDependencyStatus,
} from '../../domain/runtime/run-dependency-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import {
  createToolExecutionRepository,
  type ToolExecutionRecord,
} from '../../domain/runtime/tool-execution-repository'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { asItemId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import { resolveRunEventThreadId } from './run-events'
import {
  refreshWaitingRunSnapshot,
  type WaitingRunExecutionOutput,
  type WaitingRunPendingWait,
} from './run-persistence'
import { toToolContext } from './run-tool-execution'
import { getToolAppsMetaPayload } from './tool-apps-meta'

type WaitResolutionStatus = Extract<RunDependencyStatus, 'resolved' | 'timed_out'>

export interface RunWaitResolutionInput {
  approve?: boolean
  error?: DomainError
  errorMessage?: string
  maxOutputTokens?: number
  model?: string
  modelAlias?: string
  output?: unknown
  provider?: 'openai' | 'google'
  rememberApproval?: boolean
  temperature?: number
  waitId: string
  waitResolution?: {
    resolutionJson?: unknown
    status?: WaitResolutionStatus
  }
}

export type RunWaitResolutionState =
  | {
      kind: 'ready_to_resume'
    }
  | {
      kind: 'waiting'
      output: WaitingRunExecutionOutput
    }

const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

const serializeToolOutput = (value: unknown): string => JSON.stringify(value ?? null)

const toConflictError = (message: string): DomainError => ({
  message,
  type: 'conflict',
})

const toToolArgs = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toToolFailure = (
  input: Pick<RunWaitResolutionInput, 'error' | 'errorMessage'>,
): DomainError | null =>
  input.error ?? (input.errorMessage ? toConflictError(input.errorMessage) : null)

const toPersistedWaitOutput = (
  runDependency: Pick<RunDependencyRecord, 'targetKind' | 'type'>,
  output: unknown,
): unknown => {
  if (runDependency.type === 'agent' && runDependency.targetKind === 'run') {
    return toChildRunReplayOutput(output) ?? output
  }

  return output
}

const toChildRunResultKind = (
  input: Pick<RunWaitResolutionInput, 'errorMessage' | 'output'>,
): 'cancelled' | 'completed' | 'failed' | null => {
  if (input.errorMessage) {
    return 'failed'
  }

  if (!input.output || typeof input.output !== 'object' || Array.isArray(input.output)) {
    return null
  }

  const candidate = (input.output as { kind?: unknown }).kind

  return candidate === 'cancelled' || candidate === 'completed' || candidate === 'failed'
    ? candidate
    : null
}

const toChildRunSummary = (output: unknown): string | null => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null
  }

  const candidate = (output as { summary?: unknown }).summary

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

const toToolErrorOutput = (error: string | DomainError) =>
  typeof error === 'string'
    ? {
        error: {
          message: error,
          type: 'conflict' as const,
        },
        ok: false,
      }
    : {
        error:
          error.type === 'provider'
            ? { message: error.message, provider: error.provider, type: error.type }
            : { message: error.message, type: error.type },
        ok: false,
      }

const toConfigSnapshot = (
  context: CommandContext,
  input: Pick<
    RunWaitResolutionInput,
    'maxOutputTokens' | 'model' | 'modelAlias' | 'provider' | 'temperature'
  >,
  currentSnapshot: Record<string, unknown>,
): Record<string, unknown> => ({
  ...currentSnapshot,
  apiBasePath: context.config.api.basePath,
  maxOutputTokens: input.maxOutputTokens ?? currentSnapshot.maxOutputTokens ?? null,
  model: input.model ?? currentSnapshot.model ?? null,
  modelAlias: input.modelAlias ?? currentSnapshot.modelAlias ?? null,
  provider: input.provider ?? currentSnapshot.provider ?? context.config.ai.defaults.provider,
  temperature: input.temperature ?? currentSnapshot.temperature ?? null,
  version: context.config.api.version,
})

const isConfirmationWait = (wait: RunDependencyRecord): boolean =>
  wait.type === 'human' && wait.targetKind === 'human_response'

const requiresApprovalForWait = (
  wait: RunDependencyRecord,
  toolExecution: Pick<ToolExecutionRecord, 'domain'>,
): boolean =>
  toolExecution.domain === 'mcp' && isConfirmationWait(wait)

const toPendingWaitSummary = (
  wait: RunDependencyRecord,
  toolExecution: ToolExecutionRecord,
): WaitingRunPendingWait => ({
  args: toToolArgs(toolExecution.argsJson),
  callId: wait.callId,
  createdAt: wait.createdAt,
  description: wait.description,
  requiresApproval: requiresApprovalForWait(wait, toolExecution),
  targetKind: wait.targetKind,
  targetRef: wait.targetRef,
  tool: toolExecution.tool,
  type: wait.type,
  waitId: wait.id,
})

const appendChildRunCompletedEvent = (input: {
  context: CommandContext
  currentRun: RunRecord
  eventStore: ReturnType<typeof createEventStore>
  resolutionInput: RunWaitResolutionInput
  runDependency: RunDependencyRecord
}): void => {
  if (
    input.runDependency.type !== 'agent' ||
    input.runDependency.targetKind !== 'run' ||
    !input.runDependency.targetRunId
  ) {
    return
  }

  const resultKind = toChildRunResultKind(input.resolutionInput)

  if (!resultKind) {
    return
  }

  unwrapOrThrow(
    input.eventStore.append({
      actorAccountId: input.context.tenantScope.accountId,
      aggregateId: input.currentRun.id,
      aggregateType: 'run',
      payload: {
        callId: input.runDependency.callId,
        childRunId: input.runDependency.targetRunId,
        parentRunId: input.currentRun.id,
        resultKind,
        rootRunId: input.currentRun.rootRunId,
        runId: input.currentRun.id,
        sessionId: input.currentRun.sessionId,
        sourceCallId: input.runDependency.callId,
        ...(toChildRunSummary(input.resolutionInput.output)
          ? { summary: toChildRunSummary(input.resolutionInput.output) }
          : {}),
        threadId: resolveRunEventThreadId(input.currentRun),
        waitId: input.runDependency.id,
      },
      tenantId: input.context.tenantScope.tenantId,
      traceId: input.context.traceId,
      type: 'child_run.completed',
    }),
  )
}

const loadPendingWaitSummaries = (
  context: CommandContext,
  waits: RunDependencyRecord[],
): CommandResult<WaitingRunPendingWait[]> => {
  const toolExecutionRepository = createToolExecutionRepository(context.db)
  const summaries: WaitingRunPendingWait[] = []

  for (const wait of waits) {
    const toolExecution = toolExecutionRepository.getById(context.tenantScope, wait.callId)

    if (!toolExecution.ok) {
      return toolExecution
    }

    summaries.push(toPendingWaitSummary(wait, toolExecution.value))
  }

  return ok(summaries)
}

const resumeOrStayWaiting = async (
  context: CommandContext,
  currentRun: RunRecord,
  runId: RunId,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const runDependencyRepository = createRunDependencyRepository(context.db)
  const pendingWaits = runDependencyRepository.listPendingByRunId(context.tenantScope, runId)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  if (pendingWaits.value.length > 0) {
    const pendingWaitSummaries = loadPendingWaitSummaries(context, pendingWaits.value)

    if (!pendingWaitSummaries.ok) {
      return pendingWaitSummaries
    }

    const refreshedSnapshot = refreshWaitingRunSnapshot(
      context,
      currentRun,
      pendingWaitSummaries.value,
      pendingWaitSummaries.value.map((wait) => wait.waitId),
    )

    if (!refreshedSnapshot.ok) {
      return refreshedSnapshot
    }

    return ok({
      kind: 'waiting',
      output: refreshedSnapshot.value,
    })
  }

  return ok({
    kind: 'ready_to_resume',
  })
}

export const resolveRunWait = async (
  context: CommandContext,
  runId: RunId,
  input: RunWaitResolutionInput,
): Promise<CommandResult<RunWaitResolutionState>> => {
  try {
    const membershipRepository = createTenantMembershipRepository(context.db)
    const membership = membershipRepository.requireMembership(context.tenantScope)

    if (!membership.ok) {
      return membership
    }

    const currentRun = createResourceAccessService(context.db).requireRunAccess(
      context.tenantScope,
      runId,
    )

    if (!currentRun.ok) {
      return currentRun
    }

    let currentRunRecord = currentRun.value.run

    if (currentRunRecord.status !== 'waiting') {
      return err({
        message: `run ${runId} must be waiting before resuming`,
        type: 'conflict',
      })
    }

    if (
      input.maxOutputTokens !== undefined ||
      input.model !== undefined ||
      input.modelAlias !== undefined ||
      input.provider !== undefined ||
      input.temperature !== undefined
    ) {
      const configuredRun = withTransaction(context.db, (tx) =>
        createRunRepository(tx).updateConfigSnapshot(context.tenantScope, {
          configSnapshot: toConfigSnapshot(context, input, currentRunRecord.configSnapshot),
          expectedStatus: 'waiting',
          expectedVersion: currentRunRecord.version,
          runId,
          updatedAt: context.services.clock.nowIso(),
        }),
      )

      if (!configuredRun.ok) {
        return configuredRun
      }

      currentRunRecord = configuredRun.value
    }

    const eventThreadId = resolveRunEventThreadId(currentRunRecord)
    const runDependencyRepository = createRunDependencyRepository(context.db)
    const runDependency = runDependencyRepository.getById(context.tenantScope, input.waitId)

    if (!runDependency.ok) {
      return runDependency
    }

    if (runDependency.value.runId !== runId) {
      return err({
        message: `wait ${input.waitId} does not belong to run ${runId}`,
        type: 'conflict',
      })
    }

    if (runDependency.value.status !== 'pending') {
      return err({
        message: `wait ${input.waitId} is not pending`,
        type: 'conflict',
      })
    }

    const resolvedAt = context.services.clock.nowIso()
    const toolExecutionRepository = createToolExecutionRepository(context.db)
    const toolExecution = toolExecutionRepository.getById(
      context.tenantScope,
      runDependency.value.callId,
    )

    if (!toolExecution.ok) {
      return toolExecution
    }

    if (requiresApprovalForWait(runDependency.value, toolExecution.value)) {
      if (input.approve === undefined) {
        return err({
          message: `wait ${input.waitId} requires an explicit approve decision`,
          type: 'validation',
        })
      }

      if (!input.approve) {
        const rejectionMessage = 'MCP tool execution rejected during confirmation'
        const rejected = withTransaction(context.db, (tx) => {
          const txItemRepository = createItemRepository(tx)
          const txToolExecutionRepository = createToolExecutionRepository(tx)
          const txRunDependencyRepository = createRunDependencyRepository(tx)
          const eventStore = createEventStore(tx)
          const nextSequence = unwrapOrThrow(
            txItemRepository.getNextSequence(context.tenantScope, runId),
          )
          const errorEnvelope = toToolErrorOutput(rejectionMessage)

          unwrapOrThrow(
            txToolExecutionRepository.fail(context.tenantScope, {
              completedAt: resolvedAt,
              durationMs: null,
              errorText: rejectionMessage,
              id: runDependency.value.callId,
              outcomeJson: errorEnvelope,
            }),
          )

          unwrapOrThrow(
            txItemRepository.createFunctionCallOutput(context.tenantScope, {
              callId: runDependency.value.callId,
              createdAt: resolvedAt,
              id: asItemId(context.services.ids.create('itm')),
              output: serializeToolOutput(errorEnvelope),
              providerPayload: {
                isError: true,
                name: toolExecution.value.tool,
              },
              runId,
              sequence: nextSequence,
            }),
          )

          unwrapOrThrow(
            txRunDependencyRepository.resolve(context.tenantScope, {
              id: input.waitId,
              resolutionJson: {
                approved: false,
                error: rejectionMessage,
              },
              resolvedAt,
              status: 'resolved',
            }),
          )

          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: runDependency.value.callId,
              aggregateType: 'tool_execution',
              payload: {
                callId: runDependency.value.callId,
                ...(currentRunRecord.parentRunId
                  ? { parentRunId: currentRunRecord.parentRunId }
                  : {}),
                rootRunId: currentRunRecord.rootRunId,
                runId,
                sessionId: currentRunRecord.sessionId,
                threadId: eventThreadId,
                tool: toolExecution.value.tool,
                waitId: input.waitId,
              },
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: 'tool.confirmation_rejected',
            }),
          )

          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: runDependency.value.callId,
              aggregateType: 'tool_execution',
              payload: {
                callId: runDependency.value.callId,
                error: errorEnvelope,
                ...(currentRunRecord.parentRunId
                  ? { parentRunId: currentRunRecord.parentRunId }
                  : {}),
                rootRunId: currentRunRecord.rootRunId,
                runId,
                sessionId: currentRunRecord.sessionId,
                threadId: eventThreadId,
                tool: toolExecution.value.tool,
              },
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: 'tool.failed',
            }),
          )

          return ok(null)
        })

        if (!rejected.ok) {
          return rejected
        }

        return resumeOrStayWaiting(context, currentRunRecord, runId)
      }

      const descriptor = context.services.mcp.getTool(toolExecution.value.tool)

      if (!descriptor) {
        return err({
          message: `MCP tool ${toolExecution.value.tool} is no longer available for confirmation`,
          type: 'conflict',
        })
      }

      const rememberApprovalRequested = input.rememberApproval ?? true
      const toolProfileId = currentRunRecord.toolProfileId
      const rememberApproval = rememberApprovalRequested && toolProfileId !== null
      const approvalResolution = {
        approved: true,
        fingerprint: descriptor.fingerprint,
        remembered: rememberApproval,
      }
      const approvalAppliedAt = context.services.clock.nowIso()
      const approvalApplied = withTransaction(context.db, (tx) => {
        if (rememberApproval) {
          const assignmentRepository = createMcpToolAssignmentRepository(tx)

          unwrapOrThrow(
            assignmentRepository.approveFingerprintByAnyRuntimeName(context.tenantScope, {
              approvedAt: approvalAppliedAt,
              fingerprint: descriptor.fingerprint,
              toolProfileId,
              runtimeNames: getMcpRuntimeNameAliasesFromRuntimeName(toolExecution.value.tool),
            }),
          )
        }

        return ok(null)
      })

      if (!approvalApplied.ok) {
        return approvalApplied
      }

      const remoteResult = await context.services.mcp.callTool({
        args:
          toolExecution.value.argsJson &&
          typeof toolExecution.value.argsJson === 'object' &&
          !Array.isArray(toolExecution.value.argsJson)
            ? toolExecution.value.argsJson
            : {},
        context: toToolContext(context, currentRunRecord, runDependency.value.callId),
        runtimeName: toolExecution.value.tool,
      })

      const persistedRemoteResult = withTransaction(context.db, (tx) => {
        const txItemRepository = createItemRepository(tx)
        const txToolExecutionRepository = createToolExecutionRepository(tx)
        const txRunDependencyRepository = createRunDependencyRepository(tx)
        const eventStore = createEventStore(tx)
        const completedAt = context.services.clock.nowIso()
        const toolAppsMetaPayload = getToolAppsMetaPayload(
          context,
          toolExecution.value.tool,
          remoteResult.ok ? remoteResult.value : undefined,
        )
        const nextSequence = unwrapOrThrow(
          txItemRepository.getNextSequence(context.tenantScope, runId),
        )

        if (!remoteResult.ok) {
          const errorEnvelope = toToolErrorOutput(remoteResult.error)

          unwrapOrThrow(
            txToolExecutionRepository.fail(context.tenantScope, {
              completedAt,
              durationMs: null,
              errorText: remoteResult.error.message,
              id: runDependency.value.callId,
              outcomeJson: errorEnvelope,
            }),
          )

          unwrapOrThrow(
            txItemRepository.createFunctionCallOutput(context.tenantScope, {
              callId: runDependency.value.callId,
              createdAt: completedAt,
              id: asItemId(context.services.ids.create('itm')),
              output: serializeToolOutput(errorEnvelope),
              providerPayload: {
                isError: true,
                name: toolExecution.value.tool,
              },
              runId,
              sequence: nextSequence,
            }),
          )

          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: runDependency.value.callId,
              aggregateType: 'tool_execution',
              payload: {
                callId: runDependency.value.callId,
                ...(rememberApproval ? { fingerprint: descriptor.fingerprint } : {}),
                ...(currentRunRecord.parentRunId
                  ? { parentRunId: currentRunRecord.parentRunId }
                  : {}),
                remembered: rememberApproval,
                rootRunId: currentRunRecord.rootRunId,
                runId,
                sessionId: currentRunRecord.sessionId,
                threadId: eventThreadId,
                tool: toolExecution.value.tool,
                waitId: input.waitId,
              },
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: 'tool.confirmation_granted',
            }),
          )

          unwrapOrThrow(
            txRunDependencyRepository.resolve(context.tenantScope, {
              id: input.waitId,
              resolutionJson: approvalResolution,
              resolvedAt: completedAt,
              status: 'resolved',
            }),
          )

          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: runDependency.value.callId,
              aggregateType: 'tool_execution',
              payload: {
                ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
                callId: runDependency.value.callId,
                error: errorEnvelope,
                ...(currentRunRecord.parentRunId
                  ? { parentRunId: currentRunRecord.parentRunId }
                  : {}),
                rootRunId: currentRunRecord.rootRunId,
                runId,
                sessionId: currentRunRecord.sessionId,
                threadId: eventThreadId,
                tool: toolExecution.value.tool,
              },
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: 'tool.failed',
            }),
          )

          return ok(null)
        }

        unwrapOrThrow(
          txToolExecutionRepository.complete(context.tenantScope, {
            completedAt,
            durationMs: null,
            id: runDependency.value.callId,
            outcomeJson: remoteResult.value,
          }),
        )

        unwrapOrThrow(
          txItemRepository.createFunctionCallOutput(context.tenantScope, {
            callId: runDependency.value.callId,
            createdAt: completedAt,
            id: asItemId(context.services.ids.create('itm')),
            output: serializeToolOutput(remoteResult.value),
            providerPayload: {
              isError: false,
              name: toolExecution.value.tool,
            },
            runId,
            sequence: nextSequence,
          }),
        )

        unwrapOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: runDependency.value.callId,
            aggregateType: 'tool_execution',
            payload: {
              callId: runDependency.value.callId,
              ...(rememberApproval ? { fingerprint: descriptor.fingerprint } : {}),
              ...(currentRunRecord.parentRunId
                ? { parentRunId: currentRunRecord.parentRunId }
                : {}),
              remembered: rememberApproval,
              rootRunId: currentRunRecord.rootRunId,
              runId,
              sessionId: currentRunRecord.sessionId,
              threadId: eventThreadId,
              tool: toolExecution.value.tool,
              waitId: input.waitId,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'tool.confirmation_granted',
          }),
        )

        unwrapOrThrow(
          txRunDependencyRepository.resolve(context.tenantScope, {
            id: input.waitId,
            resolutionJson: approvalResolution,
            resolvedAt: completedAt,
            status: 'resolved',
          }),
        )

        unwrapOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: runDependency.value.callId,
            aggregateType: 'tool_execution',
            payload: {
              ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
              callId: runDependency.value.callId,
              outcome: remoteResult.value,
              ...(currentRunRecord.parentRunId
                ? { parentRunId: currentRunRecord.parentRunId }
                : {}),
              rootRunId: currentRunRecord.rootRunId,
              runId,
              sessionId: currentRunRecord.sessionId,
              threadId: eventThreadId,
              tool: toolExecution.value.tool,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'tool.completed',
          }),
        )

        return ok(null)
      })

      if (!persistedRemoteResult.ok) {
        return persistedRemoteResult
      }

      return resumeOrStayWaiting(context, currentRunRecord, runId)
    }

    const toolFailure = toToolFailure(input)

    if (input.output === undefined && !toolFailure) {
      return err({
        message: `wait ${input.waitId} requires output or errorMessage`,
        type: 'validation',
      })
    }

    const resolved = withTransaction(context.db, (tx) => {
      const txItemRepository = createItemRepository(tx)
      const txToolExecutionRepository = createToolExecutionRepository(tx)
      const txRunDependencyRepository = createRunDependencyRepository(tx)
      const eventStore = createEventStore(tx)
      const toolExecution = unwrapOrThrow(
        txToolExecutionRepository.getById(context.tenantScope, runDependency.value.callId),
      )
      const toolAppsMetaPayload = getToolAppsMetaPayload(
        context,
        toolExecution.tool,
        toolFailure ? undefined : input.output,
      )
      const nextSequence = unwrapOrThrow(
        txItemRepository.getNextSequence(context.tenantScope, runId),
      )
      const waitResolutionStatus = input.waitResolution?.status ?? 'resolved'
      const waitResolutionJson =
        input.waitResolution?.resolutionJson ??
        (toolFailure ? { error: toolFailure.message } : { output: input.output ?? null })
      const persistedOutput = toolFailure
        ? toToolErrorOutput(toolFailure)
        : toPersistedWaitOutput(runDependency.value, input.output ?? null)

      if (toolFailure) {
        unwrapOrThrow(
          txToolExecutionRepository.fail(context.tenantScope, {
            completedAt: resolvedAt,
            durationMs: null,
            errorText: toolFailure.message,
            id: runDependency.value.callId,
            outcomeJson: persistedOutput,
          }),
        )
      } else {
        unwrapOrThrow(
          txToolExecutionRepository.complete(context.tenantScope, {
            completedAt: resolvedAt,
            durationMs: null,
            id: runDependency.value.callId,
            outcomeJson: persistedOutput,
          }),
        )
      }

      unwrapOrThrow(
        txItemRepository.createFunctionCallOutput(context.tenantScope, {
          callId: runDependency.value.callId,
          createdAt: resolvedAt,
          id: asItemId(context.services.ids.create('itm')),
          output: serializeToolOutput(persistedOutput),
          providerPayload: {
            isError: Boolean(toolFailure),
            name: toolExecution.tool,
          },
          runId,
          sequence: nextSequence,
        }),
      )

      const resolvedWait = unwrapOrThrow(
        txRunDependencyRepository.resolve(context.tenantScope, {
          id: input.waitId,
          resolutionJson: waitResolutionJson,
          resolvedAt,
          status: waitResolutionStatus,
        }),
      )

      if (waitResolutionStatus === 'timed_out') {
        unwrapOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: runDependency.value.id,
            aggregateType: 'wait_entry',
            payload: {
              callId: runDependency.value.callId,
              error: toolFailure?.message ?? 'Wait timed out',
              ...(currentRunRecord.parentRunId
                ? { parentRunId: currentRunRecord.parentRunId }
                : {}),
              rootRunId: currentRunRecord.rootRunId,
              runId,
              sessionId: currentRunRecord.sessionId,
              threadId: eventThreadId,
              timeoutAt: runDependency.value.timeoutAt,
              timedOutAt: resolvedAt,
              tool: toolExecution.tool,
              waitId: input.waitId,
              waitTargetKind: runDependency.value.targetKind,
              waitTargetRef: runDependency.value.targetRef,
              ...(runDependency.value.targetRunId
                ? { waitTargetRunId: runDependency.value.targetRunId }
                : {}),
              waitType: runDependency.value.type,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'wait.timed_out',
          }),
        )
      }

      unwrapOrThrow(
        eventStore.append({
          actorAccountId: context.tenantScope.accountId,
          aggregateId: runDependency.value.callId,
          aggregateType: 'tool_execution',
          payload: {
            ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
            callId: runDependency.value.callId,
            ...(currentRunRecord.parentRunId ? { parentRunId: currentRunRecord.parentRunId } : {}),
            rootRunId: currentRunRecord.rootRunId,
            runId,
            sessionId: currentRunRecord.sessionId,
            threadId: eventThreadId,
            tool: toolExecution.tool,
            ...(toolFailure
              ? { error: toToolErrorOutput(toolFailure) }
              : { outcome: input.output ?? null }),
          },
          tenantId: context.tenantScope.tenantId,
          traceId: context.traceId,
          type: toolFailure ? 'tool.failed' : 'tool.completed',
        }),
      )

      if (waitResolutionStatus === 'resolved') {
        appendChildRunCompletedEvent({
          context,
          currentRun: currentRunRecord,
          eventStore,
          resolutionInput: input,
          runDependency: runDependency.value,
        })
      }

      return ok(resolvedWait)
    })

    if (!resolved.ok) {
      return resolved
    }

    return resumeOrStayWaiting(context, currentRunRecord, runId)
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return err(error.domainError)
    }

    const message = error instanceof Error ? error.message : 'Unknown run wait resolution failure'

    return err({
      message: `failed to resolve wait for run ${runId}: ${message}`,
      type: 'conflict',
    })
  }
}
