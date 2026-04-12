import type {
  AiInteractionRequest,
  AiInteractionResponse,
  AiMessage,
  AiOutputItem,
  AiToolCall,
  AiToolDefinition,
  AiWebSearchActivity,
} from '../../domain/ai/types'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { TelemetryCommittedEventType } from '../../domain/events/committed-event-contract'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import type { CommandContext } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import type { ContextBudgetReport } from '../interactions/context-bundle'
import { createRunEventPayload } from './run-events'

type EventScopedRun = Pick<RunRecord, 'id' | 'sessionId' | 'status' | 'threadId'> & {
  configSnapshot?: Record<string, unknown> | null
  parentRunId?: RunRecord['parentRunId']
  rootRunId?: RunRecord['rootRunId']
}

const warnTelemetryDrop = (type: TelemetryCommittedEventType, message: string) => {
  console.warn('Telemetry event dropped', {
    message,
    type,
  })
}

const toStructuredMessages = (
  messages: AiMessage[],
): Array<{
  content: AiMessage['content']
  phase?: AiMessage['phase']
  providerMessageId?: AiMessage['providerMessageId']
  role: AiMessage['role']
}> =>
  messages.map((message) => ({
    content: message.content.map((part) => ({ ...part })),
    ...(message.phase ? { phase: message.phase } : {}),
    ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
    role: message.role,
  }))

const toStructuredToolDefinitions = (
  tools: AiToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  return tools.map((tool) => ({
    ...(tool.description ? { description: tool.description } : {}),
    kind: tool.kind,
    name: tool.name,
    parameters: tool.parameters,
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    type: tool.kind,
  }))
}

const toStructuredToolCalls = (
  toolCalls: AiToolCall[],
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined
  }

  return toolCalls.map((toolCall) => ({
    ...(toolCall.arguments !== null ? { arguments: toolCall.arguments } : {}),
    argumentsJson: toolCall.argumentsJson,
    callId: toolCall.callId,
    name: toolCall.name,
    ...(toolCall.providerItemId ? { providerItemId: toolCall.providerItemId } : {}),
    ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
    type: 'function_call',
  }))
}

const toStructuredOutputItems = (
  output: AiOutputItem[],
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(output) || output.length === 0) {
    return undefined
  }

  return output.map((item) => {
    if (item.type === 'message') {
      return {
        content: item.content.map((part) => ({ ...part })),
        ...(item.phase ? { phase: item.phase } : {}),
        ...(item.providerMessageId ? { providerMessageId: item.providerMessageId } : {}),
        role: item.role,
        type: item.type,
      }
    }

    if (item.type === 'function_call') {
      return {
        ...(item.arguments !== null ? { arguments: item.arguments } : {}),
        argumentsJson: item.argumentsJson,
        callId: item.callId,
        name: item.name,
        ...(item.providerItemId ? { providerItemId: item.providerItemId } : {}),
        ...(item.thoughtSignature ? { thoughtSignature: item.thoughtSignature } : {}),
        type: item.type,
      }
    }

    return {
      ...(item.encryptedContent !== undefined ? { encryptedContent: item.encryptedContent } : {}),
      id: item.id,
      summary: item.summary,
      ...(item.text ? { text: item.text } : {}),
      ...(item.thought === true ? { thought: true } : {}),
      type: item.type,
    }
  })
}

const toGenerationModelParameters = (
  request: AiInteractionRequest,
): Record<string, number | string> | undefined => {
  const parameters: Record<string, number | string> = {}

  if (typeof request.temperature === 'number') {
    parameters.temperature = request.temperature
  }

  if (typeof request.topP === 'number') {
    parameters.topP = request.topP
  }

  if (typeof request.maxOutputTokens === 'number') {
    parameters.maxOutputTokens = request.maxOutputTokens
  }

  if (request.serviceTier) {
    parameters.serviceTier = request.serviceTier
  }

  if (typeof request.allowParallelToolCalls === 'boolean') {
    parameters.allowParallelToolCalls = request.allowParallelToolCalls ? 'true' : 'false'
  }

  if (request.reasoning) {
    parameters.reasoningEffort = request.reasoning.effort

    if (request.reasoning.summary) {
      parameters.reasoningSummary = request.reasoning.summary
    }
  }

  if (request.toolChoice) {
    parameters.toolChoice =
      typeof request.toolChoice === 'string'
        ? request.toolChoice
        : `function:${request.toolChoice.name}`
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined
}

export const tryAppendRunTelemetryEvent = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  type: TelemetryCommittedEventType,
  payload: Record<string, unknown>,
) => {
  const result = createEventStore(db).append({
    actorAccountId: context.tenantScope.accountId,
    aggregateId: run.id,
    aggregateType: 'run',
    payload: createRunEventPayload(run, payload),
    tenantId: context.tenantScope.tenantId,
    traceId: context.traceId,
    type,
  })

  if (!result.ok) {
    warnTelemetryDrop(type, result.error.message)
  }
}

export const emitProgressReported = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    detail?: string
    percent?: number
    stage: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'progress.reported', input)
}

export const emitTurnStarted = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    budget: ContextBudgetReport
    observationCount: number
    pendingWaitCount: number
    summaryId: string | null
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'turn.started', {
    estimatedInputTokens: input.budget.rawEstimatedInputTokens,
    observationCount: input.observationCount,
    pendingWaitCount: input.pendingWaitCount,
    reservedOutputTokens: input.budget.reservedOutputTokens,
    stablePrefixTokens: input.budget.stablePrefixTokens,
    summaryId: input.summaryId,
    turn: input.turn,
    volatileSuffixTokens: input.budget.volatileSuffixTokens,
  })
}

export const emitTurnCompleted = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    hasToolCalls: boolean
    outputItemCount: number
    outputTextLength: number
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'turn.completed', input)
}

export const emitGenerationStarted = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    request: AiInteractionRequest
    provider: string
    requestedModel: string | null
    startedAt: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'generation.started', {
    inputMessages: toStructuredMessages(input.request.messages),
    modelParameters: toGenerationModelParameters(input.request),
    ...(toStructuredToolDefinitions(input.request.tools) ? { tools: toStructuredToolDefinitions(input.request.tools) } : {}),
    ...(Array.isArray(input.request.nativeTools) && input.request.nativeTools.length > 0
      ? { nativeTools: [...input.request.nativeTools] }
      : {}),
    provider: input.provider,
    requestedModel: input.requestedModel,
    startedAt: input.startedAt,
    turn: input.turn,
  })
}

export const emitGenerationCompleted = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    budget: ContextBudgetReport
    response: AiInteractionResponse
    startedAt: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'generation.completed', {
    estimatedInputTokens: input.budget.rawEstimatedInputTokens,
    model: input.response.model,
    outputItemCount: input.response.output.length,
    ...(toStructuredOutputItems(input.response.output)
      ? { outputItems: toStructuredOutputItems(input.response.output) }
      : {}),
    outputMessages: toStructuredMessages(input.response.messages),
    outputText: input.response.outputText,
    provider: input.response.provider,
    providerRequestId: input.response.providerRequestId,
    responseId: input.response.responseId,
    startedAt: input.startedAt,
    status: input.response.status,
    ...(toStructuredToolCalls(input.response.toolCalls)
      ? { toolCalls: toStructuredToolCalls(input.response.toolCalls) }
      : {}),
    toolCallCount: input.response.toolCalls.length,
    turn: input.turn,
    usage: input.response.usage,
  })
}

export const emitGenerationFailed = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    error: DomainError
    provider: string
    startedAt: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'generation.failed', {
    error: input.error,
    provider: input.provider,
    startedAt: input.startedAt,
    turn: input.turn,
  })
}

export const emitReasoningSummaryDelta = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    delta: string
    itemId: string
    text: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'reasoning.summary.delta', input)
}

export const emitReasoningSummaryDone = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    itemId: string
    text: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'reasoning.summary.done', input)
}

export const emitStreamDelta = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    delta: string
    model?: string
    provider?: string
    responseId?: string | null
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'stream.delta', input)
}

export const emitStreamDone = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    model: string
    provider: string
    responseId: string | null
    text: string
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'stream.done', input)
}

export const emitWebSearchProgress = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: EventScopedRun,
  input: {
    activity: AiWebSearchActivity
    turn: number
  },
) => {
  tryAppendRunTelemetryEvent(context, db, run, 'web_search.progress', {
    patterns: input.activity.patterns,
    provider: input.activity.provider,
    queries: input.activity.queries,
    references: input.activity.references,
    responseId: input.activity.responseId,
    searchId: input.activity.id,
    status: input.activity.status,
    targetUrls: input.activity.targetUrls,
    turn: input.turn,
  })
}
