import { withTransaction } from '../../db/transaction'
import type { AiToolCall } from '../../domain/ai/types'
import { createItemRepository } from '../../domain/runtime/item-repository'
import { createRunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import { createToolExecutionRepository } from '../../domain/runtime/tool-execution-repository'
import type { ToolContext, ToolOutcome, ToolSpec } from '../../domain/tooling/tool-registry'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import { asItemId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import { isToolAllowedForRun } from '../agents/agent-runtime-policy'
import type { CommandContext } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import { assertRunSnapshotCurrent } from './run-concurrency'
import { appendDomainEvent, resolveRunEventThreadId, unwrapOrThrow } from './run-events'
import { getToolAppsMetaPayload } from './tool-apps-meta'

export interface ToolExecutionResult {
  call: AiToolCall
  domain: ToolSpec['domain']
  error?: DomainError
  outcome?: ToolOutcome
  startedAt: string
  tool: ToolSpec | null
  toolName: string
}

export interface PendingRunWaitSummary {
  args: Record<string, unknown> | null
  callId: string
  createdAt: string
  description: string | null
  requiresApproval: boolean
  targetKind: string
  targetRef: string | null
  tool: string
  type: string
  waitId: string
}

export const toToolContext = (
  context: CommandContext,
  run: RunRecord,
  toolCallId: string | null = null,
  abortSignal?: AbortSignal,
): ToolContext => ({
  abortSignal,
  config: context.config,
  createId: context.services.ids.create,
  db: context.db,
  nowIso: () => context.services.clock.nowIso(),
  requestId: context.requestId,
  run,
  services: context.services,
  tenantScope: context.tenantScope,
  toolCallId,
  traceId: context.traceId,
})

export const prepareToolExecution = (
  context: CommandContext,
  call: AiToolCall,
): ToolExecutionResult => {
  const tool = context.services.tools.get(call.name)

  return {
    call,
    domain: tool?.domain ?? 'system',
    startedAt: context.services.clock.nowIso(),
    tool,
    toolName: tool?.name ?? call.name,
  }
}

const serializeToolOutput = (value: unknown): string => JSON.stringify(value ?? null)

const toToolArgs = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toToolErrorOutput = (error: DomainError) => ({
  error:
    error.type === 'provider'
      ? { message: error.message, provider: error.provider, type: error.type }
      : { message: error.message, type: error.type },
  ok: false,
})

const toDurationMs = (startedAt: string, completedAt: string): number | null => {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null
  }

  return Math.max(0, end - start)
}

const toCancellationError = (abortSignal?: AbortSignal): DomainError => ({
  message: typeof abortSignal?.reason === 'string' ? abortSignal.reason : 'Run cancelled',
  type: 'conflict',
})

export const executeOneToolCall = async (
  context: CommandContext,
  run: RunRecord,
  prepared: ToolExecutionResult,
  abortSignal?: AbortSignal,
): Promise<ToolExecutionResult> => {
  const toolContext = toToolContext(context, run, prepared.call.callId, abortSignal)
  const { tool } = prepared

  if (abortSignal?.aborted) {
    return {
      ...prepared,
      error: toCancellationError(abortSignal),
    }
  }

  if (!tool) {
    return {
      ...prepared,
      error: {
        message: `Tool ${prepared.call.name} is not registered`,
        type: 'validation',
      },
    }
  }

  if (!isToolAllowedForRun(context.db, context.tenantScope, run, tool)) {
    return {
      ...prepared,
      error: {
        message: `Tool ${tool.name} is not allowed for agent revision ${run.agentRevisionId ?? 'unbound'}`,
        type: 'permission',
      },
    }
  }

  const validated = tool.validateArgs
    ? tool.validateArgs(prepared.call.arguments)
    : ok(prepared.call.arguments)

  if (!validated.ok) {
    return {
      ...prepared,
      error: validated.error,
    }
  }

  try {
    const outcome = await tool.execute(toolContext, validated.value)

    if (abortSignal?.aborted) {
      return {
        ...prepared,
        error: toCancellationError(abortSignal),
      }
    }

    if (!outcome.ok) {
      return {
        ...prepared,
        error: outcome.error,
      }
    }

    return {
      ...prepared,
      outcome: outcome.value,
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      return {
        ...prepared,
        error: toCancellationError(abortSignal),
      }
    }

    return {
      ...prepared,
      error: {
        message: error instanceof Error ? error.message : `Tool ${tool.name} failed unexpectedly`,
        type: 'conflict',
      },
    }
  }
}

export const persistToolCalledEvents = (
  context: CommandContext,
  run: RunRecord,
  toolCalls: ToolExecutionResult[],
  turn: number,
): Result<null, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      unwrapOrThrow(assertRunSnapshotCurrent(tx, context.tenantScope, run))

      const eventStore = createEventStore(tx)
      const toolExecutionRepository = createToolExecutionRepository(tx)
      const eventThreadId = resolveRunEventThreadId(run)

      for (const toolCall of toolCalls) {
        const toolAppsMetaPayload = getToolAppsMetaPayload(context, toolCall.toolName)

        unwrapOrThrow(
          toolExecutionRepository.create(context.tenantScope, {
            argsJson: toolCall.call.arguments ?? null,
            createdAt: toolCall.startedAt,
            domain: toolCall.domain,
            id: toolCall.call.callId,
            runId: run.id,
            startedAt: toolCall.startedAt,
            tool: toolCall.toolName,
          }),
        )

        appendDomainEvent(context, eventStore, {
          aggregateId: toolCall.call.callId,
          aggregateType: 'tool_execution',
          payload: {
            ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
            args: toToolArgs(toolCall.call.arguments),
            callId: toolCall.call.callId,
            ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
            rootRunId: run.rootRunId,
            runId: run.id,
            sessionId: run.sessionId,
            threadId: eventThreadId,
            tool: toolCall.toolName,
            turn,
          },
          type: 'tool.called',
        })
      }

      return ok(null)
    })
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return {
        error: error.domainError,
        ok: false,
      }
    }

    return {
      error: {
        message: error instanceof Error ? error.message : 'failed to persist tool call events',
        type: 'conflict',
      },
      ok: false,
    }
  }
}

export const persistToolOutcomes = (
  context: CommandContext,
  run: RunRecord,
  toolCalls: ToolExecutionResult[],
  turn: number,
): Result<{ waitIds: string[]; waits: PendingRunWaitSummary[] }, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      unwrapOrThrow(assertRunSnapshotCurrent(tx, context.tenantScope, run))

      const eventStore = createEventStore(tx)
      const itemRepository = createItemRepository(tx)
      const toolExecutionRepository = createToolExecutionRepository(tx)
      const runDependencyRepository = createRunDependencyRepository(tx)
      const eventThreadId = resolveRunEventThreadId(run)
      let nextSequence = unwrapOrThrow(itemRepository.getNextSequence(context.tenantScope, run.id))
      const waitIds: string[] = []
      const waits: PendingRunWaitSummary[] = []

      for (const result of toolCalls) {
        const completedAt = context.services.clock.nowIso()
        const toolAppsMetaPayload =
          result.error || !result.outcome || result.outcome.kind !== 'immediate'
            ? getToolAppsMetaPayload(context, result.toolName)
            : getToolAppsMetaPayload(context, result.toolName, result.outcome.output)

        if (result.error) {
          unwrapOrThrow(
            toolExecutionRepository.fail(context.tenantScope, {
              completedAt,
              durationMs: toDurationMs(result.startedAt, completedAt),
              errorText: result.error.message,
              id: result.call.callId,
              outcomeJson: toToolErrorOutput(result.error),
            }),
          )

          unwrapOrThrow(
            itemRepository.createFunctionCallOutput(context.tenantScope, {
              callId: result.call.callId,
              createdAt: completedAt,
              id: asItemId(context.services.ids.create('itm')),
              output: serializeToolOutput(toToolErrorOutput(result.error)),
              providerPayload: {
                isError: true,
                name: result.toolName,
              },
              runId: run.id,
              sequence: nextSequence,
            }),
          )
          nextSequence += 1

          appendDomainEvent(context, eventStore, {
            aggregateId: result.call.callId,
            aggregateType: 'tool_execution',
            payload: {
              ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
              callId: result.call.callId,
              error: toToolErrorOutput(result.error),
              ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
              rootRunId: run.rootRunId,
              runId: run.id,
              sessionId: run.sessionId,
              threadId: eventThreadId,
              tool: result.toolName,
              turn,
            },
            type: 'tool.failed',
          })
          continue
        }

        if (!result.outcome) {
          continue
        }

        if (result.outcome.kind === 'waiting') {
          const waitId = context.services.ids.create('wte')
          unwrapOrThrow(
            runDependencyRepository.create(context.tenantScope, {
              callId: result.call.callId,
              createdAt: completedAt,
              description: result.outcome.wait.description ?? null,
              id: waitId,
              runId: run.id,
              targetKind: result.outcome.wait.targetKind,
              targetRef: result.outcome.wait.targetRef ?? result.toolName,
              targetRunId: result.outcome.wait.targetRunId ?? null,
              timeoutAt: result.outcome.wait.timeoutAt ?? null,
              type: result.outcome.wait.type,
            }),
          )
          waitIds.push(waitId)
          waits.push({
            args: toToolArgs(result.call.arguments),
            callId: result.call.callId,
            createdAt: completedAt,
            description: result.outcome.wait.description ?? null,
            requiresApproval:
              result.domain === 'mcp' &&
              result.outcome.wait.type === 'human' &&
              result.outcome.wait.targetKind === 'human_response',
            targetKind: result.outcome.wait.targetKind,
            targetRef: result.outcome.wait.targetRef ?? result.toolName,
            tool: result.toolName,
            type: result.outcome.wait.type,
            waitId,
          })

          appendDomainEvent(context, eventStore, {
            aggregateId: result.call.callId,
            aggregateType: 'tool_execution',
            payload: {
              args: toToolArgs(result.call.arguments),
              callId: result.call.callId,
              description: result.outcome.wait.description ?? null,
              ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
              rootRunId: run.rootRunId,
              runId: run.id,
              sessionId: run.sessionId,
              threadId: eventThreadId,
              tool: result.toolName,
              turn,
              waitId,
              waitTargetKind: result.outcome.wait.targetKind,
              waitTargetRef: result.outcome.wait.targetRef ?? result.toolName,
              ...(result.outcome.wait.targetRunId
                ? { waitTargetRunId: result.outcome.wait.targetRunId }
                : {}),
              waitType: result.outcome.wait.type,
            },
            type:
              result.domain === 'mcp' &&
              result.outcome.wait.type === 'human' &&
              result.outcome.wait.targetKind === 'human_response'
                ? 'tool.confirmation_requested'
                : 'tool.waiting',
          })
          continue
        }

        unwrapOrThrow(
          toolExecutionRepository.complete(context.tenantScope, {
            completedAt,
            durationMs: toDurationMs(result.startedAt, completedAt),
            id: result.call.callId,
            outcomeJson: result.outcome.output,
          }),
        )

        unwrapOrThrow(
          itemRepository.createFunctionCallOutput(context.tenantScope, {
            callId: result.call.callId,
            createdAt: completedAt,
            id: asItemId(context.services.ids.create('itm')),
            output: serializeToolOutput(result.outcome.output),
            providerPayload: {
              isError: false,
              name: result.toolName,
            },
            runId: run.id,
            sequence: nextSequence,
          }),
        )
        nextSequence += 1

        appendDomainEvent(context, eventStore, {
          aggregateId: result.call.callId,
          aggregateType: 'tool_execution',
          payload: {
            ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
            callId: result.call.callId,
            outcome: result.outcome.output,
            ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
            rootRunId: run.rootRunId,
            runId: run.id,
            sessionId: run.sessionId,
            threadId: eventThreadId,
            tool: result.toolName,
            turn,
          },
          type: 'tool.completed',
        })
      }

      return ok({ waitIds, waits })
    })
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return {
        error: error.domainError,
        ok: false,
      }
    }

    return {
      error: {
        message: error instanceof Error ? error.message : 'failed to persist tool outcomes',
        type: 'conflict',
      },
      ok: false,
    }
  }
}
