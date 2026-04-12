import { withTransaction } from '../../db/transaction'
import { flattenReasoningSummaryText } from '../../domain/ai/reasoning-summary'
import type {
  AiInteractionResponse,
  AiOutputItem,
  AiUsage,
  AiWebReference,
} from '../../domain/ai/types'
import { createUsageLedgerRepository } from '../../domain/ai/usage-ledger-repository'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { DomainEventEnvelope } from '../../domain/events/domain-event'
import { createDomainEventRepository } from '../../domain/events/domain-event-repository'
import { createItemRepository } from '../../domain/runtime/item-repository'
import { createRunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import { createSessionMessageRepository } from '../../domain/sessions/session-message-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { ItemId, RunId, SessionMessageId } from '../../shared/ids'
import { asItemId, asRunId, asSessionMessageId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import type { ContextBudgetReport } from '../interactions/context-bundle'
import {
  normalizeAssistantMessageContent,
  normalizeAssistantOutputText,
} from '../interactions/normalize-interaction-response'
import { maybeCompactMainThreadContext } from './context-compaction'
import { markLinkedJobWaiting, markRunJobBlocked, markRunJobCompleted } from './job-sync'
import { assertRunSnapshotCurrent } from './run-concurrency'
import { appendDomainEvent, appendRunEvent, unwrapOrThrow } from './run-events'
import { emitProgressReported } from './run-telemetry'
import type { PendingRunWaitSummary } from './run-tool-execution'

export interface WaitingRunPendingWait extends PendingRunWaitSummary {}

interface PersistedAssistantToolApprovalMetadata {
  description: string | null
  remembered: boolean | null
  status: 'approved' | 'rejected'
  targetRef: string | null
  waitId: string
}

interface PersistedAssistantToolAppsMetaMetadata {
  csp?: Record<string, unknown> | null
  permissions?: Record<string, unknown> | null
  resourceUri: string
  serverId: string
}

interface PersistedAssistantToolBlockMetadata {
  args: Record<string, unknown> | null
  approval?: PersistedAssistantToolApprovalMetadata
  appsMeta?: PersistedAssistantToolAppsMetaMetadata | null
  childRunId?: string
  confirmation?: {
    description: string | null
    targetRef: string | null
    waitId: string
  }
  createdAt: string
  finishedAt?: string
  id: string
  name: string
  output?: unknown
  sourceRunId?: string
  status: 'running' | 'awaiting_confirmation' | 'complete' | 'error'
  toolCallId: string
  type: 'tool_interaction'
}

interface PersistedAssistantThinkingBlockMetadata {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  status: 'thinking' | 'done'
  title: string
  type: 'thinking'
}

interface PersistedAssistantTextBlockMetadata {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  type: 'text'
}

interface PersistedAssistantWebSearchBlockMetadata {
  createdAt: string
  finishedAt?: string
  id: string
  patterns: string[]
  provider: 'openai' | 'google'
  queries: string[]
  references: AiWebReference[]
  responseId: string | null
  searchId: string
  sourceRunId?: string
  status: 'in_progress' | 'searching' | 'completed' | 'failed'
  targetUrls: string[]
  type: 'web_search'
}

const toPersistenceFailure = (
  error: unknown,
  fallbackMessage: string,
): Result<never, DomainError> => {
  if (error instanceof DomainErrorException) {
    return err(error.domainError)
  }

  return err({
    message: error instanceof Error ? error.message : fallbackMessage,
    type: 'conflict',
  })
}

type PersistedAssistantTranscriptBlockMetadata =
  | PersistedAssistantThinkingBlockMetadata
  | PersistedAssistantTextBlockMetadata
  | PersistedAssistantToolBlockMetadata
  | PersistedAssistantWebSearchBlockMetadata

type RunTranscriptEvent = DomainEventEnvelope<unknown> & { eventNo: number }

interface PersistedAssistantTranscriptMetadata {
  blocks: PersistedAssistantTranscriptBlockMetadata[]
  toolBlocks: PersistedAssistantToolBlockMetadata[]
  webSearchBlocks: PersistedAssistantWebSearchBlockMetadata[]
  version: 2
}

interface PersistAssistantSnapshotMessageResult {
  assistantMessageId: SessionMessageId | null
  created: boolean
}

export interface CompletedRunExecutionOutput {
  assistantItemId: ItemId | null
  assistantMessageId: SessionMessageId | null
  model: string
  outputText: string
  provider: 'openai' | 'google'
  responseId: string | null
  runId: RunId
  status: 'completed'
  usage: AiUsage | null
}

export interface WaitingRunExecutionOutput {
  assistantItemId: null
  assistantMessageId: null
  model: string
  outputText: string
  pendingWaits: WaitingRunPendingWait[]
  provider: 'openai' | 'google'
  responseId: string | null
  runId: RunId
  status: 'waiting'
  usage: AiUsage | null
  waitIds: string[]
}

export type RunExecutionOutput = CompletedRunExecutionOutput | WaitingRunExecutionOutput

const toToolArgs = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toPersistedAppsMeta = (
  value: unknown,
): PersistedAssistantToolAppsMetaMetadata | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.resourceUri !== 'string' ||
    candidate.resourceUri.trim().length === 0 ||
    typeof candidate.serverId !== 'string' ||
    candidate.serverId.trim().length === 0
  ) {
    return undefined
  }

  return {
    ...(typeof candidate.csp === 'object' && candidate.csp !== null && !Array.isArray(candidate.csp)
      ? { csp: candidate.csp as Record<string, unknown> }
      : {}),
    ...(typeof candidate.permissions === 'object' &&
    candidate.permissions !== null &&
    !Array.isArray(candidate.permissions)
      ? { permissions: candidate.permissions as Record<string, unknown> }
      : {}),
    resourceUri: candidate.resourceUri,
    serverId: candidate.serverId,
  }
}

const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const dedupeWebReferences = (references: AiWebReference[]): AiWebReference[] => {
  const byUrl = new Map<string, AiWebReference>()

  for (const reference of references) {
    const existing = byUrl.get(reference.url)

    if (!existing) {
      byUrl.set(reference.url, reference)
      continue
    }

    byUrl.set(reference.url, {
      domain: existing.domain ?? reference.domain,
      title: existing.title ?? reference.title,
      url: reference.url,
    })
  }

  return [...byUrl.values()]
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const toPersistedWebReferences = (value: unknown): AiWebReference[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return dedupeWebReferences(
    value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return []
      }

      const reference = entry as Partial<AiWebReference>

      if (typeof reference.url !== 'string' || reference.url.length === 0) {
        return []
      }

      return [
        {
          domain: typeof reference.domain === 'string' ? reference.domain : null,
          title: typeof reference.title === 'string' ? reference.title : null,
          url: reference.url,
        },
      ]
    }),
  )
}

const toPersistedWebSearchStatus = (
  value: unknown,
): PersistedAssistantWebSearchBlockMetadata['status'] =>
  value === 'failed' || value === 'completed' || value === 'searching' || value === 'in_progress'
    ? value
    : 'in_progress'

const mergePersistedWebSearchStatus = (
  current: PersistedAssistantWebSearchBlockMetadata['status'],
  next: PersistedAssistantWebSearchBlockMetadata['status'],
): PersistedAssistantWebSearchBlockMetadata['status'] => {
  const rank: Record<PersistedAssistantWebSearchBlockMetadata['status'], number> = {
    in_progress: 0,
    searching: 1,
    completed: 2,
    failed: 3,
  }

  return rank[next] >= rank[current] ? next : current
}

const listRunTranscriptEvents = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  category: 'all' | 'telemetry' = 'all',
): Result<RunTranscriptEvent[], DomainError> =>
  createDomainEventRepository(db).listAfterCursor(context.tenantScope, {
    category,
    runId: run.id,
  })

const buildOutputTextFromTranscriptEvents = (events: RunTranscriptEvent[]): string => {
  let outputText = ''

  for (const event of events) {
    if (event.type === 'stream.delta') {
      const payload =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : null

      if (payload && typeof payload.delta === 'string') {
        outputText += payload.delta
      }

      continue
    }

    if (outputText.length > 0) {
      continue
    }

    if (event.type === 'stream.done' || event.type === 'generation.completed') {
      const payload =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : null

      if (payload && typeof payload.text === 'string' && payload.text.length > 0) {
        outputText = payload.text
        continue
      }

      if (payload && typeof payload.outputText === 'string' && payload.outputText.length > 0) {
        outputText = payload.outputText
      }
    }
  }

  return outputText
}

const compareTranscriptBlockOrder = (
  left: Pick<PersistedAssistantTranscriptBlockMetadata, 'createdAt' | 'id'>,
  right: Pick<PersistedAssistantTranscriptBlockMetadata, 'createdAt' | 'id'>,
): number => {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) {
    return left.id.localeCompare(right.id)
  }

  return leftTime - rightTime
}

const readRunOutputText = (run: RunRecord): string => {
  if (!run.resultJson || typeof run.resultJson !== 'object') {
    return ''
  }

  const candidate = run.resultJson as {
    outputText?: unknown
  }

  return typeof candidate.outputText === 'string' ? candidate.outputText : ''
}

const readRunTranscriptMetadata = (run: RunRecord): PersistedAssistantTranscriptMetadata | null => {
  if (!isRecord(run.resultJson) || !isRecord(run.resultJson.transcript)) {
    return null
  }

  const transcript = run.resultJson.transcript

  return transcript.version === 2
    ? (transcript as unknown as PersistedAssistantTranscriptMetadata)
    : null
}

const readRunSnapshotMetadata = (
  run: RunRecord,
): {
  model: string | null
  provider: 'openai' | 'google' | null
  providerMessageId: string | null
  responseId: string | null
} => {
  if (!isRecord(run.resultJson)) {
    return {
      model: null,
      provider: null,
      providerMessageId: null,
      responseId: null,
    }
  }

  return {
    model:
      typeof run.resultJson.model === 'string' && run.resultJson.model.length > 0
        ? run.resultJson.model
        : null,
    provider:
      run.resultJson.provider === 'openai' || run.resultJson.provider === 'google'
        ? run.resultJson.provider
        : null,
    providerMessageId:
      typeof run.resultJson.providerMessageId === 'string' &&
      run.resultJson.providerMessageId.length > 0
        ? run.resultJson.providerMessageId
        : null,
    responseId:
      typeof run.resultJson.responseId === 'string' && run.resultJson.responseId.length > 0
        ? run.resultJson.responseId
        : null,
  }
}

const collectAssistantTranscriptBlocks = (
  context: CommandContext,
  db: RepositoryDatabase,
  input: {
    persistTextBlocks: boolean
    response: AiInteractionResponse | null
    run: RunRecord
    sourceRunId?: string
    visitedRunIds: Set<string>
  },
): Result<PersistedAssistantTranscriptBlockMetadata[], DomainError> => {
  const currentRunId = String(input.run.id)
  if (input.visitedRunIds.has(currentRunId)) {
    return ok([])
  }

  input.visitedRunIds.add(currentRunId)

  const transcriptEvents = listRunTranscriptEvents(context, db, input.run, 'all')

  if (!transcriptEvents.ok) {
    return transcriptEvents
  }

  const runRepository = createRunRepository(db)
  const childRuns = runRepository.listByParentRunId(context.tenantScope, input.run.id)

  if (!childRuns.ok) {
    return childRuns
  }

  const childRunsBySourceCallId = new Map<string, RunRecord>()
  for (const childRun of childRuns.value) {
    if (!childRun.sourceCallId || childRunsBySourceCallId.has(childRun.sourceCallId)) {
      continue
    }

    childRunsBySourceCallId.set(childRun.sourceCallId, childRun)
  }

  const blocks: PersistedAssistantTranscriptBlockMetadata[] = []
  const thinkingById = new Map<string, PersistedAssistantThinkingBlockMetadata>()
  const toolByCallId = new Map<string, PersistedAssistantToolBlockMetadata>()
  const webSearchById = new Map<string, PersistedAssistantWebSearchBlockMetadata>()
  let currentTextBlock: PersistedAssistantTextBlockMetadata | null = null

  const toPayloadRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

  const closeTextBlock = () => {
    currentTextBlock = null
  }

  const ensureThinkingBlock = (
    itemId: string,
    createdAt: string,
  ): PersistedAssistantThinkingBlockMetadata => {
    const existing = thinkingById.get(itemId)

    if (existing) {
      return existing
    }

    const next: PersistedAssistantThinkingBlockMetadata = {
      content: '',
      createdAt,
      id: `thinking:${itemId}`,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'thinking',
      title: 'Reasoning',
      type: 'thinking',
    }
    thinkingById.set(itemId, next)
    blocks.push(next)
    return next
  }

  const ensureTextBlock = (
    eventNo: number,
    createdAt: string,
  ): PersistedAssistantTextBlockMetadata | null => {
    if (!input.persistTextBlocks) {
      return null
    }

    if (currentTextBlock) {
      return currentTextBlock
    }

    const next: PersistedAssistantTextBlockMetadata = {
      content: '',
      createdAt,
      id: `text:${input.sourceRunId ?? currentRunId}:${eventNo}`,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      type: 'text',
    }
    currentTextBlock = next
    blocks.push(next)
    return next
  }

  const ensureToolBlock = (
    callId: string,
    createdAt: string,
    toolName: string,
  ): PersistedAssistantToolBlockMetadata => {
    const existing = toolByCallId.get(callId)

    if (existing) {
      if (toolName.trim().length > 0) {
        existing.name = toolName
      }
      return existing
    }

    const next: PersistedAssistantToolBlockMetadata = {
      args: null,
      createdAt,
      id: `tool:${callId}`,
      name: toolName,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'running',
      toolCallId: callId,
      type: 'tool_interaction',
    }
    toolByCallId.set(callId, next)
    blocks.push(next)
    return next
  }

  const ensureWebSearchBlock = (
    searchId: string,
    createdAt: string,
    provider: 'openai' | 'google',
  ): PersistedAssistantWebSearchBlockMetadata => {
    const existing = webSearchById.get(searchId)

    if (existing) {
      existing.provider = provider
      return existing
    }

    const next: PersistedAssistantWebSearchBlockMetadata = {
      createdAt,
      id: `web_search:${searchId}`,
      patterns: [],
      provider,
      queries: [],
      references: [],
      responseId: null,
      searchId,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'in_progress',
      targetUrls: [],
      type: 'web_search',
    }
    webSearchById.set(searchId, next)
    blocks.push(next)
    return next
  }

  for (const event of transcriptEvents.value) {
    const payload = toPayloadRecord(event.payload)

    if (!payload) {
      continue
    }

    if (event.type === 'stream.delta') {
      const block = ensureTextBlock(event.eventNo, event.createdAt)
      if (block && typeof payload.delta === 'string') {
        block.content += payload.delta
      }
      continue
    }

    if (event.type !== 'progress.reported') {
      closeTextBlock()
    }

    if (event.type === 'reasoning.summary.delta' || event.type === 'reasoning.summary.done') {
      if (typeof payload.itemId !== 'string' || typeof payload.text !== 'string') {
        continue
      }

      const block = ensureThinkingBlock(payload.itemId, event.createdAt)
      block.content = payload.text
      block.status = event.type === 'reasoning.summary.done' ? 'done' : 'thinking'
      continue
    }

    if (event.type === 'web_search.progress') {
      if (typeof payload.searchId !== 'string') {
        continue
      }

      const block = ensureWebSearchBlock(
        payload.searchId,
        event.createdAt,
        payload.provider === 'google' ? 'google' : 'openai',
      )

      const nextStatus = toPersistedWebSearchStatus(payload.status)

      block.patterns = dedupeStrings([...block.patterns, ...toStringArray(payload.patterns)])
      block.provider = payload.provider === 'google' ? 'google' : 'openai'
      block.queries = dedupeStrings([...block.queries, ...toStringArray(payload.queries)])
      block.references = dedupeWebReferences([
        ...block.references,
        ...toPersistedWebReferences(payload.references),
      ])
      block.responseId =
        block.responseId ?? (typeof payload.responseId === 'string' ? payload.responseId : null)
      block.status = mergePersistedWebSearchStatus(block.status, nextStatus)
      block.targetUrls = dedupeStrings([...block.targetUrls, ...toStringArray(payload.targetUrls)])

      if (nextStatus === 'completed' || nextStatus === 'failed') {
        block.finishedAt = event.createdAt
      }
      continue
    }

    if (
      event.type === 'tool.called' ||
      event.type === 'tool.waiting' ||
      event.type === 'tool.confirmation_requested' ||
      event.type === 'tool.confirmation_granted' ||
      event.type === 'tool.confirmation_rejected' ||
      event.type === 'tool.completed' ||
      event.type === 'tool.failed'
    ) {
      if (typeof payload.callId !== 'string') {
        continue
      }

      const block = ensureToolBlock(
        payload.callId,
        event.createdAt,
        typeof payload.tool === 'string' && payload.tool.trim().length > 0
          ? payload.tool
          : 'unknown_tool',
      )
      const persistedAppsMeta = toPersistedAppsMeta(payload.appsMeta)

      if (persistedAppsMeta) {
        block.appsMeta = persistedAppsMeta
      }

      if (event.type === 'tool.called') {
        block.args = toToolArgs(payload.args)
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.waiting') {
        block.args = toToolArgs(payload.args) ?? block.args
        if (typeof payload.waitTargetRunId === 'string' && payload.waitTargetRunId.length > 0) {
          block.childRunId = payload.waitTargetRunId
        }
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.confirmation_requested') {
        block.args = toToolArgs(payload.args)
        block.confirmation = {
          description: typeof payload.description === 'string' ? payload.description : null,
          targetRef: typeof payload.waitTargetRef === 'string' ? payload.waitTargetRef : null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.status = 'awaiting_confirmation'
        continue
      }

      if (event.type === 'tool.confirmation_granted') {
        block.approval = {
          description: block.confirmation?.description ?? null,
          remembered: typeof payload.remembered === 'boolean' ? payload.remembered : null,
          status: 'approved',
          targetRef: block.confirmation?.targetRef ?? null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.confirmation = undefined
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.confirmation_rejected') {
        block.approval = {
          description: block.confirmation?.description ?? null,
          remembered: null,
          status: 'rejected',
          targetRef: block.confirmation?.targetRef ?? null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.confirmation = undefined
        block.status = 'error'
        continue
      }

      if (event.type === 'tool.completed') {
        if (Object.hasOwn(payload, 'outcome')) {
          block.output = payload.outcome
        }
        block.confirmation = undefined
        block.finishedAt = event.createdAt
        block.status = 'complete'
        continue
      }

      if (Object.hasOwn(payload, 'error')) {
        block.output = payload.error
      }
      block.confirmation = undefined
      block.finishedAt = event.createdAt
      block.status = 'error'
    }
  }

  for (const outputItem of input.response?.output ?? []) {
    if (outputItem.type !== 'reasoning' || thinkingById.has(outputItem.id)) {
      continue
    }

    const content =
      typeof outputItem.text === 'string' && outputItem.text.trim().length > 0
        ? outputItem.text.trim()
        : flattenReasoningSummaryText(outputItem.summary)

    if (content.length === 0) {
      continue
    }

    const block = ensureThinkingBlock(outputItem.id, input.run.completedAt ?? input.run.updatedAt)
    block.content = content
    block.status = 'done'
  }

  for (const webSearch of input.response?.webSearches ?? []) {
    if (webSearchById.has(webSearch.id)) {
      continue
    }

    const block = ensureWebSearchBlock(
      webSearch.id,
      input.run.completedAt ?? input.run.updatedAt,
      webSearch.provider,
    )
    block.patterns = webSearch.patterns
    block.provider = webSearch.provider
    block.queries = webSearch.queries
    block.references = dedupeWebReferences(webSearch.references)
    block.responseId = webSearch.responseId
    block.status = webSearch.status
    block.targetUrls = webSearch.targetUrls

    if (webSearch.status === 'completed' || webSearch.status === 'failed') {
      block.finishedAt = input.run.completedAt ?? input.run.updatedAt
    }
  }

  if (input.persistTextBlocks && !blocks.some((block) => block.type === 'text')) {
    const outputText =
      buildOutputTextFromTranscriptEvents(transcriptEvents.value) || readRunOutputText(input.run)
    if (outputText.trim().length > 0) {
      blocks.push({
        content: outputText,
        createdAt: input.run.completedAt ?? input.run.updatedAt,
        id: `text:${input.sourceRunId ?? currentRunId}:persisted`,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        type: 'text',
      })
    }
  }

  const childRunsById = new Map<string, RunRecord>()

  for (const block of toolByCallId.values()) {
    if (block.name !== 'delegate_to_agent') {
      continue
    }

    const sourcedChildRun = childRunsBySourceCallId.get(block.toolCallId)
    const childRunId = block.childRunId ?? sourcedChildRun?.id

    if (!childRunId) {
      continue
    }

    block.childRunId = childRunId

    if (sourcedChildRun && sourcedChildRun.id === childRunId) {
      childRunsById.set(childRunId, sourcedChildRun)
      continue
    }

    const childRun = runRepository.getById(context.tenantScope, asRunId(childRunId))
    if (!childRun.ok) {
      return childRun
    }

    childRunsById.set(childRunId, childRun.value)
  }

  for (const childRun of childRunsById.values()) {
    const childBlocks = collectAssistantTranscriptBlocks(context, db, {
      persistTextBlocks: true,
      response: null,
      run: childRun,
      sourceRunId: String(childRun.id),
      visitedRunIds: input.visitedRunIds,
    })

    if (!childBlocks.ok) {
      return childBlocks
    }

    blocks.push(...childBlocks.value)
  }

  return ok(blocks.sort(compareTranscriptBlockOrder))
}

export const buildRunTranscriptSnapshot = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  input: {
    createdAt: string
    response?: AiInteractionResponse | null
  },
): Result<
  {
    outputText: string
    transcript: PersistedAssistantTranscriptMetadata | null
  },
  DomainError
> => {
  const telemetryEvents = listRunTranscriptEvents(context, db, run, 'telemetry')

  if (!telemetryEvents.ok) {
    return telemetryEvents
  }

  const transcript = buildAssistantTranscriptMetadata(
    context,
    db,
    run,
    input.response ?? null,
    input.createdAt,
  )

  if (!transcript.ok) {
    return transcript
  }

  return ok({
    outputText:
      buildOutputTextFromTranscriptEvents(telemetryEvents.value) || readRunOutputText(run),
    transcript: transcript.value ?? readRunTranscriptMetadata(run),
  })
}

export const persistAssistantSnapshotMessageInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  input: {
    createdAt: string
    finishReason?: 'cancelled' | 'error' | 'stop' | 'waiting' | null
    outputText: string
    transcript: PersistedAssistantTranscriptMetadata | null
  },
): Result<PersistAssistantSnapshotMessageResult, DomainError> => {
  if (!run.threadId) {
    return ok({
      assistantMessageId: null,
      created: false,
    })
  }

  const existingAssistantMessageId =
    isRecord(run.resultJson) &&
    typeof run.resultJson.assistantMessageId === 'string' &&
    run.resultJson.assistantMessageId.length > 0
      ? asSessionMessageId(run.resultJson.assistantMessageId)
      : null

  if (existingAssistantMessageId) {
    return ok({
      assistantMessageId: existingAssistantMessageId,
      created: false,
    })
  }

  const outputText = input.outputText.trim()

  if (outputText.length === 0 && !input.transcript) {
    return ok({
      assistantMessageId: null,
      created: false,
    })
  }

  const sessionMessageRepository = createSessionMessageRepository(db)
  const nextMessageSequence = unwrapOrThrow(
    sessionMessageRepository.getNextSequence(context.tenantScope, run.threadId),
  )
  const snapshotMetadata = readRunSnapshotMetadata(run)
  const assistantMessageId = asSessionMessageId(context.services.ids.create('msg'))
  const metadata = {
    ...(input.finishReason ? { finishReason: input.finishReason } : {}),
    ...(snapshotMetadata.model ? { model: snapshotMetadata.model } : {}),
    ...(snapshotMetadata.provider ? { provider: snapshotMetadata.provider } : {}),
    ...(snapshotMetadata.providerMessageId
      ? { providerMessageId: snapshotMetadata.providerMessageId }
      : {}),
    ...(snapshotMetadata.responseId ? { responseId: snapshotMetadata.responseId } : {}),
    ...(input.transcript ? { transcript: input.transcript } : {}),
  }

  unwrapOrThrow(
    sessionMessageRepository.createAssistantMessage(context.tenantScope, {
      content: outputText.length > 0 ? [{ text: outputText, type: 'text' as const }] : [],
      createdAt: input.createdAt,
      id: assistantMessageId,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      runId: run.id,
      sequence: nextMessageSequence,
      sessionId: run.sessionId,
      threadId: run.threadId,
    }),
  )

  return ok({
    assistantMessageId,
    created: true,
  })
}

const buildAssistantTranscriptMetadata = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  response: AiInteractionResponse | null,
  createdAt: string,
): Result<PersistedAssistantTranscriptMetadata | null, DomainError> => {
  const blocks = collectAssistantTranscriptBlocks(context, db, {
    persistTextBlocks: false,
    response,
    run: {
      ...run,
      completedAt: run.completedAt ?? createdAt,
      updatedAt: createdAt,
    },
    visitedRunIds: new Set<string>(),
  })

  if (!blocks.ok) {
    return blocks
  }

  if (blocks.value.length === 0) {
    return ok(null)
  }

  return ok({
    blocks: blocks.value,
    toolBlocks: blocks.value.filter(
      (block): block is PersistedAssistantToolBlockMetadata => block.type === 'tool_interaction',
    ),
    version: 2,
    webSearchBlocks: blocks.value.filter(
      (block): block is PersistedAssistantWebSearchBlockMetadata => block.type === 'web_search',
    ),
  })
}

const getPersistedOutputItems = (response: AiInteractionResponse): AiOutputItem[] => {
  if (Array.isArray(response.output)) {
    return response.output
  }

  const output: AiOutputItem[] = []

  for (const message of response.messages) {
    if (message.role !== 'assistant') {
      continue
    }

    output.push({
      content: message.content,
      phase: message.phase,
      role: 'assistant',
      type: 'message',
    })
  }

  for (const toolCall of response.toolCalls) {
    output.push({
      ...toolCall,
      type: 'function_call',
    })
  }

  return output
}

const compactRunContextAtBoundary = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
): Result<null, DomainError> => {
  const itemRepository = createItemRepository(db)
  const runDependencyRepository = createRunDependencyRepository(db)
  const items = itemRepository.listByRunId(context.tenantScope, run.id)

  if (!items.ok) {
    return items
  }

  const pendingWaits = runDependencyRepository.listPendingByRunId(context.tenantScope, run.id)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  const compacted = maybeCompactMainThreadContext(
    {
      config: context.config,
      createId: context.services.ids.create,
      db,
      nowIso: () => context.services.clock.nowIso(),
      scope: context.tenantScope,
    },
    run,
    items.value,
    pendingWaits.value,
  )

  if (!compacted.ok) {
    return compacted
  }

  return ok(null)
}

export const persistUsageEntry = (
  context: CommandContext,
  run: RunRecord,
  usage: AiUsage | null,
  model: string,
  provider: 'openai' | 'google',
  createdAt: string,
  budget: ContextBudgetReport,
): Result<null, DomainError> => {
  try {
    return withTransaction(context.db, (tx) =>
      persistUsageEntryInTransaction(context, tx, run, usage, model, provider, createdAt, budget),
    )
  } catch (error) {
    return toPersistenceFailure(error, 'failed to persist usage entry')
  }
}

const persistUsageEntryInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  usage: AiUsage | null,
  model: string,
  provider: 'openai' | 'google',
  createdAt: string,
  budget: ContextBudgetReport,
): Result<null, DomainError> => {
  unwrapOrThrow(assertRunSnapshotCurrent(db, context.tenantScope, run))

  const usageLedgerRepository = createUsageLedgerRepository(db)
  unwrapOrThrow(
    usageLedgerRepository.createInteractionEntry(context.tenantScope, {
      cachedTokens: usage?.cachedTokens ?? null,
      createdAt,
      estimatedInputTokens: budget.rawEstimatedInputTokens,
      estimatedOutputTokens: budget.reservedOutputTokens,
      id: context.services.ids.create('usg'),
      inputTokens: usage?.inputTokens ?? null,
      model,
      outputTokens: usage?.outputTokens ?? null,
      provider,
      runId: run.id,
      sessionId: run.sessionId,
      stablePrefixTokens: budget.stablePrefixTokens,
      threadId: run.threadId,
      turn: run.turnCount + 1,
      volatileSuffixTokens: budget.volatileSuffixTokens,
    }),
  )

  return ok(null)
}

export const persistOutputItems = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  createdAt: string,
): Result<{ assistantItemIds: ItemId[] }, DomainError> => {
  try {
    return withTransaction(context.db, (tx) =>
      persistOutputItemsInTransaction(context, tx, run, response, createdAt),
    )
  } catch (error) {
    return toPersistenceFailure(error, 'failed to persist output items')
  }
}

const persistOutputItemsInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  response: AiInteractionResponse,
  createdAt: string,
): Result<{ assistantItemIds: ItemId[] }, DomainError> => {
  unwrapOrThrow(assertRunSnapshotCurrent(db, context.tenantScope, run))

  const itemRepository = createItemRepository(db)
  let nextSequence = unwrapOrThrow(itemRepository.getNextSequence(context.tenantScope, run.id))
  const assistantItemIds: ItemId[] = []

  for (const outputItem of getPersistedOutputItems(response)) {
    if (outputItem.type === 'message') {
      const textContent = outputItem.content.reduce<
        Array<{
          text: string
          thought?: boolean
          thoughtSignature?: string
          type: 'text'
        }>
      >((parts, part) => {
        if (part.type === 'text') {
          parts.push({
            ...(part.thought === true ? { thought: true } : {}),
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
            text: part.text,
            type: 'text',
          })
        }

        return parts
      }, [])

      if (textContent.length === 0) {
        continue
      }

      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createMessage(context.tenantScope, {
          content: textContent,
          createdAt,
          id: itemId,
          providerPayload: {
            phase: outputItem.phase ?? null,
            provider: response.provider,
            providerMessageId: outputItem.providerMessageId ?? null,
            responseId: response.responseId,
          },
          role: 'assistant',
          runId: run.id,
          sequence: nextSequence,
        }),
      )
      assistantItemIds.push(itemId)
      nextSequence += 1
      continue
    }

    if (outputItem.type === 'reasoning') {
      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createReasoning(context.tenantScope, {
          createdAt,
          id: itemId,
          providerPayload: {
            encryptedContent: outputItem.encryptedContent ?? null,
            providerItemId: outputItem.id,
            provider: response.provider,
            responseId: response.responseId,
          },
          runId: run.id,
          sequence: nextSequence,
          summary: outputItem.summary,
        }),
      )
      nextSequence += 1
      continue
    }

    if (outputItem.type === 'function_call') {
      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createFunctionCall(context.tenantScope, {
          argumentsJson: outputItem.argumentsJson,
          callId: outputItem.callId,
          createdAt,
          id: itemId,
          name: outputItem.name,
          providerPayload: {
            provider: response.provider,
            providerItemId: outputItem.providerItemId ?? null,
            responseId: response.responseId,
            thoughtSignature: outputItem.thoughtSignature ?? null,
          },
          runId: run.id,
          sequence: nextSequence,
        }),
      )
      nextSequence += 1
    }
  }

  return ok({ assistantItemIds })
}

export const completeRunWithAssistantMessage = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  completedAt: string,
  budget: ContextBudgetReport,
): Result<CompletedRunExecutionOutput, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const sessionMessageRepository = createSessionMessageRepository(tx)
      const eventStore = createEventStore(tx)
      unwrapOrThrow(
        persistUsageEntryInTransaction(
          context,
          tx,
          run,
          response.usage,
          response.model,
          response.provider,
          completedAt,
          budget,
        ),
      )
      const outputPersistence = unwrapOrThrow(
        persistOutputItemsInTransaction(context, tx, run, response, completedAt),
      )
      const assistantItemId = outputPersistence.assistantItemIds.at(-1) ?? null
      let assistantMessageId: SessionMessageId | null = null

      const assistantContent = normalizeAssistantMessageContent(response)
      const assistantOutputText = normalizeAssistantOutputText(response)
      const transcript = unwrapOrThrow(
        buildAssistantTranscriptMetadata(context, tx, run, response, completedAt),
      )

      if (assistantContent && run.threadId) {
        const nextMessageSequence = unwrapOrThrow(
          sessionMessageRepository.getNextSequence(context.tenantScope, run.threadId),
        )
        assistantMessageId = asSessionMessageId(context.services.ids.create('msg'))
        unwrapOrThrow(
          sessionMessageRepository.createAssistantMessage(context.tenantScope, {
            content: assistantContent,
            createdAt: completedAt,
            id: assistantMessageId,
            metadata: {
              model: response.model,
              provider: response.provider,
              providerMessageId:
                response.output.find((item) => item.type === 'message')?.providerMessageId ?? null,
              responseId: response.responseId,
              ...(transcript ? { transcript } : {}),
            },
            runId: run.id,
            sequence: nextMessageSequence,
            sessionId: run.sessionId,
            threadId: run.threadId,
          }),
        )

        appendDomainEvent(context, eventStore, {
          aggregateId: assistantMessageId,
          aggregateType: 'session_message',
          payload: {
            messageId: assistantMessageId,
            runId: run.id,
            sessionId: run.sessionId,
            threadId: run.threadId,
          },
          type: 'message.posted',
        })
      }

      const completedRun = unwrapOrThrow(
        runRepository.complete(context.tenantScope, {
          completedAt,
          expectedStatus: 'running',
          expectedVersion: run.version,
          lastProgressAt: completedAt,
          resultJson: {
            assistantMessageId,
            model: response.model,
            outputText: assistantOutputText,
            provider: response.provider,
            providerRequestId: response.providerRequestId,
            responseId: response.responseId,
            ...(transcript ? { transcript } : {}),
            usage: response.usage,
          },
          runId: run.id,
          turnCount: run.turnCount,
          updatedAt: completedAt,
        }),
      )

      appendRunEvent(context, eventStore, completedRun, 'run.completed', {
        assistantMessageId,
        model: response.model,
        outputText: assistantOutputText,
        provider: response.provider,
        providerRequestId: response.providerRequestId,
        responseId: response.responseId,
        usage: response.usage,
      })
      unwrapOrThrow(
        markRunJobCompleted(tx, context.tenantScope, completedRun, {
          completedAt,
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          resultJson: completedRun.resultJson,
        }),
      )
      emitProgressReported(context, tx, completedRun, {
        detail: 'Run completed successfully',
        percent: 100,
        stage: 'run.completed',
        turn: completedRun.turnCount,
      })

      unwrapOrThrow(compactRunContextAtBoundary(context, tx, completedRun))

      return ok({
        assistantItemId,
        assistantMessageId,
        model: response.model,
        outputText: assistantOutputText,
        provider: response.provider,
        responseId: response.responseId,
        runId: run.id,
        status: 'completed',
        usage: response.usage,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to complete run with assistant message')
  }
}

export const markRunWaiting = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  pendingWaits: WaitingRunPendingWait[],
  waitIds: string[],
): Result<WaitingRunExecutionOutput, DomainError> => {
  const now = context.services.clock.nowIso()

  try {
    return withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const runDependencyRepository = createRunDependencyRepository(tx)
      const transcript = unwrapOrThrow(
        buildAssistantTranscriptMetadata(context, tx, run, response, now),
      )
      const waitingRun = unwrapOrThrow(
        runRepository.markWaiting(context.tenantScope, {
          expectedStatus: 'running',
          expectedVersion: run.version,
          lastProgressAt: now,
          resultJson: {
            model: response.model,
            outputText: response.outputText,
            pendingWaits,
            provider: response.provider,
            responseId: response.responseId,
            ...(transcript ? { transcript } : {}),
            usage: response.usage,
            waitIds,
          },
          runId: run.id,
          updatedAt: now,
        }),
      )
      const pendingWaitEntries = unwrapOrThrow(
        runDependencyRepository.listPendingByRunId(context.tenantScope, waitingRun.id),
      )
      const nextSchedulerCheckAt =
        pendingWaitEntries
          .map((wait) => wait.timeoutAt)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .sort()[0] ?? null

      appendRunEvent(context, eventStore, waitingRun, 'run.waiting', {
        model: response.model,
        pendingWaits,
        outputText: response.outputText,
        provider: response.provider,
        responseId: response.responseId,
        usage: response.usage,
        waitIds,
      })
      unwrapOrThrow(
        markLinkedJobWaiting(tx, context.tenantScope, waitingRun, {
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          nextSchedulerCheckAt,
          updatedAt: now,
          waitIds,
        }),
      )

      unwrapOrThrow(compactRunContextAtBoundary(context, tx, waitingRun))

      return ok({
        assistantItemId: null,
        assistantMessageId: null,
        model: response.model,
        outputText: response.outputText,
        pendingWaits,
        provider: response.provider,
        responseId: response.responseId,
        runId: run.id,
        status: 'waiting',
        usage: response.usage,
        waitIds,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to mark run waiting')
  }
}

export const refreshWaitingRunSnapshot = (
  context: CommandContext,
  run: RunRecord,
  pendingWaits: WaitingRunPendingWait[],
  waitIds: string[],
): Result<WaitingRunExecutionOutput, DomainError> => {
  const now = context.services.clock.nowIso()

  try {
    return withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const runDependencyRepository = createRunDependencyRepository(tx)
      const transcript = unwrapOrThrow(
        buildAssistantTranscriptMetadata(context, tx, run, null, now),
      )
      const currentSnapshot = isRecord(run.resultJson) ? run.resultJson : {}
      const refreshedRun = unwrapOrThrow(
        runRepository.refreshWaiting(context.tenantScope, {
          expectedStatus: 'waiting',
          expectedVersion: run.version,
          lastProgressAt: now,
          resultJson: {
            ...currentSnapshot,
            outputText: readRunOutputText(run),
            pendingWaits,
            ...(transcript ? { transcript } : {}),
            waitIds,
          },
          runId: run.id,
          updatedAt: now,
        }),
      )
      const pendingWaitEntries = unwrapOrThrow(
        runDependencyRepository.listPendingByRunId(context.tenantScope, refreshedRun.id),
      )
      const nextSchedulerCheckAt =
        pendingWaitEntries
          .map((wait) => wait.timeoutAt)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .sort()[0] ?? null

      appendRunEvent(context, eventStore, refreshedRun, 'run.waiting', {
        model:
          typeof currentSnapshot.model === 'string' && currentSnapshot.model.length > 0
            ? currentSnapshot.model
            : null,
        pendingWaits,
        outputText: readRunOutputText(refreshedRun),
        provider:
          currentSnapshot.provider === 'openai' || currentSnapshot.provider === 'google'
            ? currentSnapshot.provider
            : null,
        responseId:
          typeof currentSnapshot.responseId === 'string' ? currentSnapshot.responseId : null,
        usage: currentSnapshot.usage ?? null,
        waitIds,
      })
      unwrapOrThrow(
        markLinkedJobWaiting(tx, context.tenantScope, refreshedRun, {
          nextSchedulerCheckAt,
          updatedAt: now,
          waitIds,
        }),
      )

      return ok({
        assistantItemId: null,
        assistantMessageId: null,
        model:
          typeof currentSnapshot.model === 'string' && currentSnapshot.model.length > 0
            ? currentSnapshot.model
            : context.config.ai.defaults.model,
        outputText: readRunOutputText(refreshedRun),
        pendingWaits,
        provider:
          currentSnapshot.provider === 'openai' || currentSnapshot.provider === 'google'
            ? currentSnapshot.provider
            : context.config.ai.defaults.provider,
        responseId:
          typeof currentSnapshot.responseId === 'string' ? currentSnapshot.responseId : null,
        runId: refreshedRun.id,
        status: 'waiting',
        usage: null,
        waitIds,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to refresh waiting run snapshot')
  }
}

export const failRun = (
  context: CommandContext,
  run: RunRecord,
  error: DomainError,
): Result<never, DomainError> => {
  const failedAt = context.services.clock.nowIso()
  let failedResult: Result<RunRecord, DomainError>

  try {
    failedResult = withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const transcriptSnapshot = unwrapOrThrow(
        buildRunTranscriptSnapshot(context, tx, run, {
          createdAt: failedAt,
        }),
      )
      const failedRun = unwrapOrThrow(
        runRepository.fail(context.tenantScope, {
          completedAt: failedAt,
          errorJson: {
            ...error,
            ...(transcriptSnapshot.transcript ? { transcript: transcriptSnapshot.transcript } : {}),
            ...(transcriptSnapshot.outputText.length > 0
              ? { outputText: transcriptSnapshot.outputText }
              : {}),
          },
          expectedStatus: run.status,
          expectedVersion: run.version,
          lastProgressAt: failedAt,
          resultJson:
            transcriptSnapshot.transcript || transcriptSnapshot.outputText.length > 0
              ? {
                  ...(transcriptSnapshot.transcript
                    ? { transcript: transcriptSnapshot.transcript }
                    : {}),
                  ...(transcriptSnapshot.outputText.length > 0
                    ? { outputText: transcriptSnapshot.outputText }
                    : {}),
                }
              : null,
          runId: run.id,
          turnCount: run.turnCount,
          updatedAt: failedAt,
        }),
      )

      appendRunEvent(context, eventStore, failedRun, 'run.failed', {
        error,
        ...(transcriptSnapshot.outputText.length > 0
          ? { outputText: transcriptSnapshot.outputText }
          : {}),
      })
      unwrapOrThrow(
        markRunJobBlocked(tx, context.tenantScope, failedRun, {
          error,
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          updatedAt: failedAt,
        }),
      )
      emitProgressReported(context, tx, failedRun, {
        detail: error.message,
        percent: 100,
        stage: 'run.failed',
        turn: failedRun.turnCount,
      })

      return ok(failedRun)
    })
  } catch (caughtError) {
    return toPersistenceFailure(caughtError, 'failed to mark run failed')
  }

  if (!failedResult.ok) {
    return failedResult
  }

  return err(error)
}
