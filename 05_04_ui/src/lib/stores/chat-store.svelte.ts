import type {
  BackendAccountPreferences,
  BackendEvent,
  BackendUsage,
  BackendModelsCatalog,
  BackendPendingWait,
  BackendRun,
  BackendSession,
  BackendThread,
  BackendThreadMessage,
  Block,
  ChatModel,
  ChatReasoningMode,
  ConversationTargetInput,
  CreateSessionInput,
  CreateSessionThreadInput,
  MessageAttachment,
  MessageFinishReason,
  MessageId,
  MessageRole,
  MessageStatus,
  ReasoningEffort,
  RunId,
  SessionId,
  ThreadId,
} from '../../../shared/chat'
import {
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
  BACKEND_DEFAULT_MODEL,
  BACKEND_DEFAULT_REASONING,
} from '../../../shared/chat'
import { stripLargeTextPasteHiddenMetadata } from '../prompt-editor/large-paste'
import {
  applyEvent,
  mergePendingWaitBlocks,
  materializePersistedAssistantBlocks,
} from '../runtime/materialize'
import { logChatDebug, registerChatDebugSnapshot } from '../runtime/chat-debug'
import {
  branchThread,
  cancelRun,
  createSession,
  createSessionThread,
  deleteThread,
  editThreadMessage,
  getAccountPreferences,
  getAgent,
  getRun,
  getSupportedModels,
  getThreadBudget,
  getThread,
  listThreadMessages,
  postThreadMessage,
  regenerateThreadTitle,
  renameThread,
  resumeRun,
  startThreadInteraction,
  streamThreadEvents,
  type ThreadBudgetSnapshot,
} from '../services/api'
import { humanizeErrorMessage } from '../services/response-errors'
import { isAbortError } from '../services/sse'

const DEFAULT_TITLE = 'Streaming Agent UI'
const STORAGE_KEY = '05_04_ui.active-thread'
const BACKEND_DEFAULT_MODEL_VALUE = BACKEND_DEFAULT_MODEL
const BACKEND_DEFAULT_REASONING_VALUE = BACKEND_DEFAULT_REASONING
const PREFERRED_DEFAULT_MODEL = 'gpt-5.4' as const
const PREFERRED_DEFAULT_REASONING = 'medium' as const
type ConversationTargetMode = 'default' | 'assistant' | 'agent'

interface ChatReasoningModeOption {
  id: ChatReasoningMode
  label: string
}

interface PersistedChatState {
  attachmentsByMessageId?: Record<string, MessageAttachment[]>
  eventCursor: number
  liveAssistantMessage?: UiMessage | null
  runId: string | null
  sessionId: string | null
  threadId: string | null
}

export interface UiMessage {
  id: MessageId
  uiKey?: string
  role: MessageRole
  status: MessageStatus
  createdAt: string
  text: string
  attachments: MessageAttachment[]
  blocks: Block[]
  finishReason: MessageFinishReason | null
  runId: RunId | null
  sequence: number | null
}

export interface MessageEditDraft {
  activationId: string
  attachments: MessageAttachment[]
  messageId: MessageId
  text: string
}

export type MemoryActivity = 'idle' | 'observing' | 'reflecting'

export interface ContextBudget {
  actualInputTokens: number | null
  actualOutputTokens: number | null
  actualTotalTokens: number | null
  cachedInputTokens: number | null
  contextWindow?: number | null
  estimatedInputTokens: number
  liveOutputTokens: number
  liveOutputText: string
  measuredAt: string | null
  model: string | null
  provider: string | null
  reasoningTokens: number | null
  reservedOutputTokens: number | null
  stablePrefixTokens: number | null
  turn: number | null
  volatileSuffixTokens: number | null
}

interface ChatState {
  activeAgentId: string | null
  activeAgentName: string | null
  availableModels: ChatModel[]
  contextBudget: ContextBudget | null
  defaultTarget: BackendAccountPreferences['defaultTarget'] | null
  defaultTargetAgentName: string | null
  eventCursor: number
  isCancelling: boolean
  isLoading: boolean
  isThreadNaming: boolean
  isReconnecting: boolean
  isResolvingWait: boolean
  resolvingWaitIds: Set<string>
  isStreaming: boolean
  isWaiting: boolean
  error: string | null
  memoryActivity: MemoryActivity
  messageEditDraft: MessageEditDraft | null
  messages: UiMessage[]
  pendingWaits: BackendPendingWait[]
  runId: RunId | null
  runStatus: BackendRun['status'] | null
  sessionId: SessionId | null
  streamPulse: number
  targetMode: ConversationTargetMode
  threadTitle: string | null
  threadId: ThreadId | null
  title: string
  waitIds: string[]
  chatModel: ChatModel
  chatReasoningMode: ChatReasoningMode
  modelsCatalog: BackendModelsCatalog | null
}

interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export interface ChatStoreDependencies {
  branchThread?: typeof branchThread
  cancelRun?: typeof cancelRun
  completedResponseStreamDrainMs?: number
  createSession?: (input: CreateSessionInput) => Promise<BackendSession>
  createSessionThread?: (
    sessionId: SessionId,
    input: CreateSessionThreadInput,
  ) => Promise<BackendThread>
  deleteThread?: typeof deleteThread
  editThreadMessage?: typeof editThreadMessage
  getAccountPreferences?: typeof getAccountPreferences
  getAgent?: typeof getAgent
  getRun?: typeof getRun
  getSupportedModels?: typeof getSupportedModels
  getThreadBudget?: typeof getThreadBudget
  getThread?: typeof getThread
  listThreadMessages?: typeof listThreadMessages
  now?: () => number
  nowIso?: () => string
  postThreadMessage?: typeof postThreadMessage
  randomUUID?: () => string
  regenerateThreadTitle?: typeof regenerateThreadTitle
  renameThread?: typeof renameThread
  resumeRun?: typeof resumeRun
  runReconcileDelayMs?: number
  startThreadInteraction?: typeof startThreadInteraction
  storage?: StorageLike | null
  streamThreadEvents?: typeof streamThreadEvents
}

const cloneAttachments = (attachments: MessageAttachment[]): MessageAttachment[] =>
  attachments.map((attachment) => ({ ...attachment }))

const cloneBlocks = (blocks: Block[]): Block[] => JSON.parse(JSON.stringify(blocks)) as Block[]

const cloneUiMessage = (message: UiMessage): UiMessage => ({
  ...message,
  attachments: cloneAttachments(message.attachments),
  blocks: cloneBlocks(message.blocks),
})

const messageTextFromParts = (message: BackendThreadMessage): string =>
  message.content
    .map((part) => part.text)
    .join('\n')
    .trim()

const readPersistedMessageFinishReason = (metadata: unknown): MessageFinishReason | null => {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }

  const record = metadata as Record<string, unknown>

  return isMessageFinishReason(record.finishReason) ? record.finishReason : null
}

const toUiMessage = (
  message: BackendThreadMessage,
  attachments: MessageAttachment[] = [],
): UiMessage => {
  const role = message.authorKind === 'assistant' ? 'assistant' : 'user'
  const rawText = messageTextFromParts(message)
  const text = role === 'user' ? stripLargeTextPasteHiddenMetadata(rawText) : rawText

  return {
    id: message.id,
    uiKey: message.id,
    role,
    status: 'complete',
    createdAt: message.createdAt,
    text,
    attachments: cloneAttachments(attachments),
    blocks:
      role === 'assistant'
        ? materializePersistedAssistantBlocks(text, message.createdAt, message.metadata)
        : [],
    finishReason: role === 'assistant' ? readPersistedMessageFinishReason(message.metadata) : null,
    runId: message.runId,
    sequence: message.sequence,
  }
}

const isTerminalRunStatus = (
  status: BackendRun['status'] | null,
): status is 'completed' | 'failed' | 'cancelled' =>
  status === 'completed' || status === 'failed' || status === 'cancelled'

const getStorage = (storage: StorageLike | null | undefined): StorageLike | null => {
  if (storage !== undefined) {
    return storage
  }

  if (typeof localStorage === 'undefined') {
    return null
  }

  return localStorage
}

const isMessageAttachment = (value: unknown): value is MessageAttachment => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const attachment = value as Partial<MessageAttachment>
  return (
    typeof attachment.id === 'string' &&
    typeof attachment.name === 'string' &&
    typeof attachment.size === 'number' &&
    typeof attachment.mime === 'string' &&
    (attachment.kind === 'image' || attachment.kind === 'file') &&
    typeof attachment.url === 'string' &&
    (attachment.thumbnailUrl === undefined || typeof attachment.thumbnailUrl === 'string')
  )
}

const parsePersistedAttachments = (value: unknown): Record<string, MessageAttachment[]> => {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([messageId, attachments]) => {
      if (!Array.isArray(attachments)) {
        return []
      }

      const normalized = attachments
        .filter(isMessageAttachment)
        .map((attachment) => ({ ...attachment }))
      return normalized.length > 0 ? [[messageId, normalized]] : []
    }),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const estimateTextTokens = (text: string): number => {
  const normalized = text.trim()

  if (normalized.length === 0) {
    return 0
  }

  return Math.max(1, Math.ceil(normalized.length / 4))
}

const toNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseUsage = (
  value: BackendUsage | Record<string, unknown> | null | undefined,
): {
  cachedTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
} | null => {
  if (!value || !isRecord(value)) {
    return null
  }

  return {
    cachedTokens: toNumberOrNull(value.cachedTokens),
    inputTokens: toNumberOrNull(value.inputTokens),
    outputTokens: toNumberOrNull(value.outputTokens),
    reasoningTokens: toNumberOrNull(value.reasoningTokens),
    totalTokens: toNumberOrNull(value.totalTokens),
  }
}

const isMessageFinishReason = (value: unknown): value is MessageFinishReason =>
  value === 'stop' || value === 'cancelled' || value === 'error' || value === 'waiting'

const isPendingWait = (value: unknown): value is BackendPendingWait => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.waitId === 'string' &&
    typeof value.callId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.tool === 'string' &&
    typeof value.type === 'string' &&
    typeof value.targetKind === 'string' &&
    (value.args === null || isRecord(value.args)) &&
    (value.description === null || typeof value.description === 'string') &&
    (value.ownerRunId === undefined || typeof value.ownerRunId === 'string') &&
    (value.requiresApproval === undefined || typeof value.requiresApproval === 'boolean') &&
    (value.targetRef === null || typeof value.targetRef === 'string')
  )
}

const parsePendingWaits = (value: unknown): BackendPendingWait[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isPendingWait).map((wait) => ({
    ...wait,
    args: wait.args ? { ...wait.args } : null,
  }))
}

const toContextBudget = (budget: ThreadBudgetSnapshot): ContextBudget => ({
  actualInputTokens: budget.actualInputTokens,
  actualOutputTokens: budget.actualOutputTokens,
  actualTotalTokens: budget.actualTotalTokens,
  cachedInputTokens: budget.cachedInputTokens,
  contextWindow: budget.contextWindow,
  estimatedInputTokens: budget.estimatedInputTokens,
  liveOutputTokens: 0,
  liveOutputText: '',
  measuredAt: budget.measuredAt,
  model: budget.model,
  provider: budget.provider,
  reasoningTokens: budget.reasoningTokens,
  reservedOutputTokens: budget.reservedOutputTokens,
  stablePrefixTokens: budget.stablePrefixTokens,
  turn: budget.turn,
  volatileSuffixTokens: budget.volatileSuffixTokens,
})

const withStreamingBudgetStart = (
  budget: ContextBudget | null,
  input: {
    estimatedInputTokens: number
    reservedOutputTokens: number | null
    stablePrefixTokens: number | null
    turn: number | null
    volatileSuffixTokens: number | null
  },
): ContextBudget => ({
  actualInputTokens: null,
  actualOutputTokens: null,
  actualTotalTokens: null,
  cachedInputTokens: null,
  contextWindow: budget?.contextWindow ?? null,
  estimatedInputTokens: input.estimatedInputTokens,
  liveOutputTokens: 0,
  liveOutputText: '',
  measuredAt: null,
  model: budget?.model ?? null,
  provider: budget?.provider ?? null,
  reasoningTokens: null,
  reservedOutputTokens: input.reservedOutputTokens,
  stablePrefixTokens: input.stablePrefixTokens,
  turn: input.turn,
  volatileSuffixTokens: input.volatileSuffixTokens,
})

const withEstimatedOutputDelta = (budget: ContextBudget | null, delta: string): ContextBudget | null => {
  if (!budget) {
    return null
  }

  const liveOutputText = budget.liveOutputText + delta

  return {
    ...budget,
    liveOutputText,
    liveOutputTokens: estimateTextTokens(liveOutputText),
  }
}

const withReconciledUsage = (
  budget: ContextBudget | null,
  usage: ReturnType<typeof parseUsage>,
  measuredAt: string,
  model: string | null,
  provider: string | null,
  fallbackOutputText: string,
): ContextBudget | null => {
  if (!budget) {
    return null
  }

  const actualOutputTokens = usage?.outputTokens ?? estimateTextTokens(fallbackOutputText)

  return {
    ...budget,
    actualInputTokens: usage?.inputTokens ?? null,
    actualOutputTokens,
    actualTotalTokens: usage?.totalTokens ?? null,
    cachedInputTokens: usage?.cachedTokens ?? null,
    liveOutputTokens: actualOutputTokens,
    liveOutputText: fallbackOutputText,
    measuredAt,
    model: model ?? budget.model,
    provider: provider ?? budget.provider,
    reasoningTokens: usage?.reasoningTokens ?? null,
  }
}

const isConfirmationPendingWait = (wait: BackendPendingWait): boolean =>
  wait.requiresApproval === true

const isReplyablePendingWait = (wait: BackendPendingWait): boolean =>
  !isConfirmationPendingWait(wait) && wait.type === 'human' && wait.targetKind === 'human_response'

const parsePersistedLiveAssistantMessage = (value: unknown): UiMessage | null => {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.id !== 'string' ||
    value.role !== 'assistant' ||
    typeof value.status !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.text !== 'string' ||
    !Array.isArray(value.blocks)
  ) {
    return null
  }

  const attachments = Array.isArray(value.attachments)
    ? value.attachments.filter(isMessageAttachment).map((attachment) => ({ ...attachment }))
    : []

  return {
    attachments,
    blocks: cloneBlocks(value.blocks as Block[]),
    createdAt: value.createdAt,
    finishReason:
      value.finishReason === null || isMessageFinishReason(value.finishReason)
        ? value.finishReason
        : null,
    id: asMessageId(value.id),
    uiKey: typeof value.uiKey === 'string' ? value.uiKey : value.id,
    role: 'assistant',
    runId: typeof value.runId === 'string' ? asRunId(value.runId) : null,
    sequence: typeof value.sequence === 'number' ? value.sequence : null,
    status: value.status as MessageStatus,
    text: value.text,
  }
}

const readPersistedState = (storage: StorageLike | null): PersistedChatState | null => {
  if (!storage) {
    return null
  }

  const rawValue = storage.getItem(STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistedChatState
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.eventCursor !== 'number') {
      return null
    }

    return {
      ...parsed,
      attachmentsByMessageId: parsePersistedAttachments(parsed.attachmentsByMessageId),
      liveAssistantMessage: parsePersistedLiveAssistantMessage(parsed.liveAssistantMessage),
    }
  } catch {
    return null
  }
}

const deriveAvailableModels = (catalog: BackendModelsCatalog): ChatModel[] => {
  const availableModels: ChatModel[] = [BACKEND_DEFAULT_MODEL_VALUE]
  const seenModels = new Set<string>([BACKEND_DEFAULT_MODEL_VALUE])

  for (const alias of catalog.aliases) {
    if (!alias.configured || seenModels.has(alias.model)) {
      continue
    }

    seenModels.add(alias.model)
    availableModels.push(alias.model as ChatModel)
  }

  return availableModels
}

const pickPreferredModel = (
  availableModels: readonly ChatModel[],
  catalog: BackendModelsCatalog | null,
): ChatModel => {
  if (availableModels.includes(PREFERRED_DEFAULT_MODEL as ChatModel)) {
    return PREFERRED_DEFAULT_MODEL as ChatModel
  }

  const catalogDefaultModel = catalog?.defaultModel as ChatModel | undefined
  if (catalogDefaultModel && availableModels.includes(catalogDefaultModel)) {
    return catalogDefaultModel
  }

  return (
    availableModels.find((model) => model !== BACKEND_DEFAULT_MODEL_VALUE) ??
    (BACKEND_DEFAULT_MODEL_VALUE as ChatModel)
  )
}

const getSelectedModelAliases = (catalog: BackendModelsCatalog | null, model: ChatModel) => {
  if (!catalog) {
    return []
  }

  if (model === BACKEND_DEFAULT_MODEL_VALUE) {
    return catalog.aliases.filter((alias) => alias.isDefault)
  }

  return catalog.aliases.filter((alias) => alias.configured && alias.model === model)
}

const deriveAvailableReasoningModes = (
  catalog: BackendModelsCatalog | null,
  model: ChatModel,
): ChatReasoningModeOption[] => {
  const reasoningModes = new Set<ReasoningEffort>()

  for (const alias of getSelectedModelAliases(catalog, model)) {
    for (const effort of alias.reasoningModes) {
      reasoningModes.add(effort)
    }
  }

  const options: ChatReasoningModeOption[] = [
    {
      id: BACKEND_DEFAULT_REASONING_VALUE,
      label: 'default',
    },
  ]

  if (!catalog) {
    return options
  }

  for (const mode of catalog.reasoningModes) {
    if (reasoningModes.has(mode.effort)) {
      options.push({
        id: mode.effort,
        label: mode.label,
      })
    }
  }

  return options
}

const pickPreferredReasoningMode = (
  availableReasoningModes: readonly ChatReasoningModeOption[],
): ChatReasoningMode => {
  const explicitModes = availableReasoningModes.filter(
    (mode) => mode.id !== BACKEND_DEFAULT_REASONING_VALUE,
  )

  if (explicitModes.length === 1 && explicitModes[0]?.id === 'none') {
    return BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode
  }

  return (availableReasoningModes.find((mode) => mode.id === PREFERRED_DEFAULT_REASONING)?.id ??
    explicitModes[0]?.id ??
    BACKEND_DEFAULT_REASONING_VALUE) as ChatReasoningMode
}

export const createChatStore = (dependencies: ChatStoreDependencies = {}) => {
  const branchThreadImpl = dependencies.branchThread ?? branchThread
  const cancelRunImpl = dependencies.cancelRun ?? cancelRun
  const createSessionImpl = dependencies.createSession ?? createSession
  const createSessionThreadImpl = dependencies.createSessionThread ?? createSessionThread
  const deleteThreadImpl = dependencies.deleteThread ?? deleteThread
  const editThreadMessageImpl = dependencies.editThreadMessage ?? editThreadMessage
  const getAccountPreferencesImpl =
    dependencies.getAccountPreferences ??
    (typeof window === 'undefined' ? null : getAccountPreferences)
  const getAgentImpl = dependencies.getAgent ?? getAgent
  const getRunImpl = dependencies.getRun ?? getRun
  const getSupportedModelsImpl =
    dependencies.getSupportedModels ?? (typeof window === 'undefined' ? null : getSupportedModels)
  const getThreadBudgetImpl = dependencies.getThreadBudget ?? getThreadBudget
  const getThreadImpl = dependencies.getThread ?? getThread
  const listThreadMessagesImpl = dependencies.listThreadMessages ?? listThreadMessages
  const now = dependencies.now ?? Date.now
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString())
  const postThreadMessageImpl = dependencies.postThreadMessage ?? postThreadMessage
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())
  const regenerateThreadTitleImpl = dependencies.regenerateThreadTitle ?? regenerateThreadTitle
  const renameThreadImpl = dependencies.renameThread ?? renameThread
  const resumeRunImpl = dependencies.resumeRun ?? resumeRun
  const completedResponseStreamDrainMs = dependencies.completedResponseStreamDrainMs ?? 250
  const runReconcileDelayMs = dependencies.runReconcileDelayMs ?? 2_000
  const startThreadInteractionImpl = dependencies.startThreadInteraction ?? startThreadInteraction
  const storage = getStorage(dependencies.storage)
  const streamThreadEventsImpl = dependencies.streamThreadEvents ?? streamThreadEvents
  const localAttachmentsByMessageId = new Map<string, MessageAttachment[]>()
  const messageIndexById = new Map<string, number>()
  const toolIndexByMessageId = new Map<string, Map<string, number>>()
  let activeStreamAbortController: AbortController | null = null
  let activeStreamPromise: Promise<void> | null = null
  let activeCompletedResponseTimer: ReturnType<typeof setTimeout> | null = null
  let activeRunReconcileTimer: ReturnType<typeof setTimeout> | null = null
  let liveAssistantMessageId: MessageId | null = null
  let pendingOptimisticMessageId: MessageId | null = null
  let projectedSyncBatchDepth = 0
  let projectedSyncPending = false
  let projectedSyncPendingPulse = false
  const stableUiKeyByMessageId = new Map<MessageId, string>()

  const toDisplayError = (error: unknown, fallback: string): string =>
    error instanceof Error ? humanizeErrorMessage(error.message) : fallback

  const state: ChatState = $state({
    activeAgentId: null,
    activeAgentName: null,
    availableModels: [BACKEND_DEFAULT_MODEL_VALUE as ChatModel],
    contextBudget: null,
    defaultTarget: null,
    defaultTargetAgentName: null,
    eventCursor: 0,
    isCancelling: false,
    isLoading: false,
    isThreadNaming: false,
    isReconnecting: false,
    isResolvingWait: false,
    resolvingWaitIds: new Set<string>(),
    isStreaming: false,
    isWaiting: false,
    error: null,
    memoryActivity: 'idle' as MemoryActivity,
    messageEditDraft: null,
    messages: [],
    pendingWaits: [],
    runId: null,
    runStatus: null,
    sessionId: null,
    streamPulse: 0,
    targetMode: 'default',
    threadTitle: null,
    threadId: null,
    title: DEFAULT_TITLE,
    waitIds: [],
    chatModel: BACKEND_DEFAULT_MODEL_VALUE as ChatModel,
    chatReasoningMode: BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode,
    modelsCatalog: null,
  })
  let durableMessages: UiMessage[] = $state([])
  let optimisticMessages: UiMessage[] = $state([])
  let liveAssistantMessage: UiMessage | null = $state(null)

  const summarizeMessage = (message: UiMessage) => ({
    blockTypes: message.blocks.map((block) => block.type),
    id: message.id,
    role: message.role,
    runId: message.runId,
    sequence: message.sequence,
    status: message.status,
    textLength: message.text.length,
    uiKey: message.uiKey ?? message.id,
  })

  const getChatStoreDebugSnapshot = () => ({
    durableMessages: durableMessages.map(summarizeMessage),
    eventCursor: state.eventCursor,
    isStreaming: state.isStreaming,
    isWaiting: state.isWaiting,
    liveAssistantMessage: liveAssistantMessage ? summarizeMessage(liveAssistantMessage) : null,
    optimisticMessages: optimisticMessages.map(summarizeMessage),
    projectedMessages: state.messages.map(summarizeMessage),
    runId: state.runId,
    runStatus: state.runStatus,
    threadId: state.threadId,
  })

  registerChatDebugSnapshot('store', getChatStoreDebugSnapshot)

  const hasKeepWorthyMessageContent = (
    message: Pick<UiMessage, 'blocks' | 'text'> | null | undefined,
  ): boolean => !!message && (message.text.trim().length > 0 || message.blocks.length > 0)

  const durableHasAssistantForRun = (runId: RunId | null): boolean =>
    !!runId &&
    durableMessages.some(
      (message) => message.role === 'assistant' && message.runId === runId,
    )

  const hasRichAssistantTranscript = (message: UiMessage): boolean =>
    message.blocks.some((block) => block.type !== 'text') || message.blocks.length > 1

  const rememberStableUiKey = (messageId: MessageId, uiKey: string) => {
    stableUiKeyByMessageId.set(messageId, uiKey)
  }

  const resolveStableUiKey = (message: Pick<UiMessage, 'id' | 'uiKey'>): string =>
    stableUiKeyByMessageId.get(message.id) ?? message.uiKey ?? message.id

  const withStableUiKey = (message: UiMessage): UiMessage => {
    const uiKey = resolveStableUiKey(message)
    return message.uiKey === uiKey ? message : { ...message, uiKey }
  }

  const mergeAssistantToolBlocks = (blocks: Block[]): Block[] => {
    const merged: Block[] = []
    const toolIndexByCallId = new Map<string, number>()

    for (const block of blocks) {
      if (block?.type !== 'tool_interaction') {
        merged.push(block)
        continue
      }

      const existingIndex = toolIndexByCallId.get(block.toolCallId)
      if (existingIndex === undefined) {
        toolIndexByCallId.set(block.toolCallId, merged.length)
        merged.push(block)
        continue
      }

      const existing = merged[existingIndex]
      if (existing?.type !== 'tool_interaction') {
        merged[existingIndex] = block
        continue
      }

      merged[existingIndex] = {
        ...existing,
        ...block,
        args: block.args ?? existing.args ?? null,
        approval: block.approval ?? existing.approval,
        confirmation: block.confirmation ?? existing.confirmation,
        output: Object.prototype.hasOwnProperty.call(block, 'output')
          ? block.output
          : existing.output,
      }
    }

    return merged
  }

  const overlayDurableAssistantFromLive = (message: UiMessage): UiMessage => {
    if (
      !liveAssistantMessage ||
      message.role !== 'assistant' ||
      message.runId == null ||
      liveAssistantMessage.runId !== message.runId ||
      liveAssistantMessage.blocks.length === 0
    ) {
      return message
    }

    const liveHasRenderableTranscript = liveAssistantMessage.blocks.some((block) => {
      if (block.type === 'text' || block.type === 'thinking' || block.type === 'web_search') {
        return true
      }

      return block.type === 'tool_interaction' && block.status !== 'awaiting_confirmation'
    })

    if (!liveHasRenderableTranscript) {
      return message
    }

    if (
      hasRichAssistantTranscript(message) &&
      isTerminalRunStatus(state.runStatus) &&
      state.runId !== liveAssistantMessage.runId
    ) {
      return message
    }

    const normalizedLiveBlocks = mergeAssistantToolBlocks(cloneBlocks(liveAssistantMessage.blocks))

    return {
      ...message,
      blocks: normalizedLiveBlocks,
      finishReason:
        liveAssistantMessage.finishReason === 'waiting' && message.finishReason === 'stop'
          ? message.finishReason
          : (liveAssistantMessage.finishReason ?? message.finishReason),
      status: liveAssistantMessage.status,
      text: liveAssistantMessage.text.trim().length > 0 ? liveAssistantMessage.text : message.text,
    }
  }

  const buildProjectedMessages = (): UiMessage[] => {
    const durableIds = new Set(durableMessages.map((message) => message.id))
    const projected = durableMessages.map(withStableUiKey)

    for (const message of optimisticMessages) {
      if (!durableIds.has(message.id)) {
        projected.push(withStableUiKey(message))
      }
    }

    const shouldProjectLiveAssistant =
      !!liveAssistantMessage &&
      !durableHasAssistantForRun(liveAssistantMessage.runId) &&
      (
        state.isStreaming ||
        state.isWaiting ||
        hasKeepWorthyMessageContent(liveAssistantMessage) ||
        (isTerminalRunStatus(state.runStatus) && liveAssistantMessage.runId != null)
      )

    if (shouldProjectLiveAssistant && liveAssistantMessage) {
      projected.push(withStableUiKey(liveAssistantMessage))
    }

    return projected
  }

  const applyThreadTitle = (thread: Pick<BackendThread, 'title'>) => {
    state.threadTitle = thread.title?.trim() || null
    state.title = state.threadTitle ?? DEFAULT_TITLE
  }

  const clearDefaultTargetState = () => {
    state.defaultTarget = null
    state.defaultTargetAgentName = null
  }

  const clearTargetSelectionState = () => {
    state.activeAgentId = null
    state.activeAgentName = null
    state.targetMode = 'default'
  }

  const refreshAccountPreferencesState = async (): Promise<void> => {
    if (!getAccountPreferencesImpl) {
      clearDefaultTargetState()
      return
    }

    const preferences = await getAccountPreferencesImpl()
    state.defaultTarget = preferences.defaultTarget

    if (preferences.defaultTarget.kind !== 'agent') {
      state.defaultTargetAgentName = null
      return
    }

    try {
      const agent = await getAgentImpl(preferences.defaultTarget.agentId)
      state.defaultTargetAgentName = agent.name
    } catch {
      state.defaultTargetAgentName = null
    }
  }

  const resolveConversationTarget = (
    agentSelection?: {
      agentId: string
      agentName?: string | null
    },
  ):
    | {
        ok: true
        value: {
          nextActiveAgentId: string | null
          nextActiveAgentName: string | null
          nextTargetMode: ConversationTargetMode
          target?: ConversationTargetInput
        }
      }
    | { ok: false; error: string } => {
    const submittedAgentId = agentSelection?.agentId?.trim() || null
    const submittedAgentName = agentSelection?.agentName?.trim() || null

    if (submittedAgentId) {
      return {
        ok: true,
        value: {
          nextActiveAgentId: submittedAgentId,
          nextActiveAgentName: submittedAgentName,
          nextTargetMode: 'agent',
          target: {
            agentId: submittedAgentId,
            kind: 'agent',
          },
        },
      }
    }

    if (state.targetMode === 'assistant') {
      return {
        ok: true,
        value: {
          nextActiveAgentId: state.activeAgentId,
          nextActiveAgentName: state.activeAgentName,
          nextTargetMode: 'assistant',
          target: {
            kind: 'assistant',
          },
        },
      }
    }

    if (state.targetMode === 'agent') {
      const activeAgentId = state.activeAgentId?.trim() || null

      if (!activeAgentId) {
        return {
          error: 'Choose an agent or switch to Assistant/Default before sending.',
          ok: false,
        }
      }

      return {
        ok: true,
        value: {
          nextActiveAgentId: activeAgentId,
          nextActiveAgentName: state.activeAgentName,
          nextTargetMode: 'agent',
          target: {
            agentId: activeAgentId,
            kind: 'agent',
          },
        },
      }
    }

    return {
      ok: true,
      value: {
        nextActiveAgentId: state.activeAgentId,
        nextActiveAgentName: state.activeAgentName,
        nextTargetMode: 'default',
      },
    }
  }

  const requestedModel = (): string | undefined =>
    state.chatModel === BACKEND_DEFAULT_MODEL_VALUE ? undefined : state.chatModel

  const requestedProvider = (): 'openai' | 'google' | undefined => {
    if (state.chatModel === BACKEND_DEFAULT_MODEL_VALUE) {
      return undefined
    }

    return getSelectedModelAliases(state.modelsCatalog, state.chatModel)[0]?.provider
  }

  const requestedModelSelection = (): { model?: string; provider?: 'openai' | 'google' } => {
    const model = requestedModel()

    if (!model) {
      return {}
    }

    return {
      model,
      ...(requestedProvider() ? { provider: requestedProvider() } : {}),
    }
  }

  const requestedReasoning = () =>
    state.chatReasoningMode === BACKEND_DEFAULT_REASONING_VALUE
      ? undefined
      : {
          effort: state.chatReasoningMode as ReasoningEffort,
        }

  const reconcileReasoningMode = (options: { preferExplicitDefault?: boolean } = {}) => {
    const availableReasoningModes = deriveAvailableReasoningModes(
      state.modelsCatalog,
      state.chatModel,
    )

    if (
      state.chatReasoningMode !== BACKEND_DEFAULT_REASONING_VALUE &&
      availableReasoningModes.some((mode) => mode.id === state.chatReasoningMode)
    ) {
      return
    }

    if (
      state.chatReasoningMode === BACKEND_DEFAULT_REASONING_VALUE &&
      !options.preferExplicitDefault &&
      availableReasoningModes.some((mode) => mode.id === state.chatReasoningMode)
    ) {
      return
    }

    state.chatReasoningMode = pickPreferredReasoningMode(availableReasoningModes)
  }

  const refreshAvailableModels = async () => {
    if (!getSupportedModelsImpl) {
      return
    }

    const catalog = await getSupportedModelsImpl()
    const availableModels = deriveAvailableModels(catalog)
    state.modelsCatalog = catalog
    state.availableModels = availableModels

    if (
      state.chatModel === BACKEND_DEFAULT_MODEL_VALUE ||
      !availableModels.includes(state.chatModel)
    ) {
      state.chatModel = pickPreferredModel(availableModels, catalog)
    }

    reconcileReasoningMode({
      preferExplicitDefault: state.chatReasoningMode === BACKEND_DEFAULT_REASONING_VALUE,
    })
  }

  const getPersistedLiveAssistantMessage = (): UiMessage | null => {
    if (!liveAssistantMessageId || !liveAssistantMessage) {
      return null
    }

    const message = liveAssistantMessage
    if (message.role !== 'assistant' || message.runId == null) {
      return null
    }

    if (isTerminalRunStatus(state.runStatus)) {
      if (state.runStatus !== 'failed' && state.runStatus !== 'cancelled') {
        return null
      }

      const hasKeepWorthyContent =
        message.text.trim().length > 0 || message.blocks.length > 0
      if (!hasKeepWorthyContent) {
        return null
      }

      return cloneUiMessage(message)
    }

    if (state.runId == null || message.runId !== state.runId) {
      return null
    }

    return cloneUiMessage(message)
  }

  const persistState = () => {
    if (!storage) {
      return
    }

    const attachmentsByMessageId = Object.fromEntries(
      Array.from(localAttachmentsByMessageId.entries()).map(([messageId, attachments]) => [
        messageId,
        cloneAttachments(attachments),
      ]),
    )

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attachmentsByMessageId,
        eventCursor: state.eventCursor,
        liveAssistantMessage: getPersistedLiveAssistantMessage(),
        runId: state.runId,
        sessionId: state.sessionId,
        threadId: state.threadId,
      } satisfies PersistedChatState),
    )
  }

  const clearPersistedState = () => {
    storage?.removeItem(STORAGE_KEY)
  }

  const getLocalAttachments = (messageId: MessageId): MessageAttachment[] =>
    cloneAttachments(localAttachmentsByMessageId.get(messageId) ?? [])

  const cloneMessageEditDraft = (draft: MessageEditDraft | null): MessageEditDraft | null =>
    draft
      ? {
          ...draft,
          attachments: cloneAttachments(draft.attachments),
        }
      : null

  const updateMessageEditDraft = (input: {
    attachments: MessageAttachment[]
    messageId: MessageId
    text: string
  }) => {
    if (state.messageEditDraft?.messageId !== input.messageId) {
      return
    }

    state.messageEditDraft = {
      ...state.messageEditDraft,
      attachments: cloneAttachments(input.attachments),
      text: input.text,
    }
  }

  const clearMessageEditDraft = () => {
    state.messageEditDraft = null
  }

  const setLocalAttachments = (messageId: MessageId, attachments: MessageAttachment[]) => {
    if (attachments.length === 0) {
      localAttachmentsByMessageId.delete(messageId)
      persistState()
      return
    }

    localAttachmentsByMessageId.set(messageId, cloneAttachments(attachments))
    persistState()
  }

  const rebuildMessageIndex = () => {
    messageIndexById.clear()
    for (let i = 0; i < state.messages.length; i += 1) {
      messageIndexById.set(state.messages[i].id, i)
    }
  }

  const rebuildToolBlockIndexes = () => {
    toolIndexByMessageId.clear()

    for (const message of state.messages) {
      const toolIndex = new Map<string, number>()

      for (let index = 0; index < message.blocks.length; index += 1) {
        const block = message.blocks[index]
        if (block?.type === 'tool_interaction') {
          toolIndex.set(block.toolCallId, index)
        }
      }

      if (toolIndex.size > 0) {
        toolIndexByMessageId.set(message.id, toolIndex)
      }
    }
  }

  const flushProjectedMessages = (options: { pulse?: boolean } = {}) => {
    state.messages = buildProjectedMessages()
    rebuildMessageIndex()
    rebuildToolBlockIndexes()
    logChatDebug('store', 'syncProjectedMessages', getChatStoreDebugSnapshot())
    if (options.pulse) {
      state.streamPulse += 1
    }
  }

  const syncProjectedMessages = (options: { pulse?: boolean } = {}) => {
    if (projectedSyncBatchDepth > 0) {
      projectedSyncPending = true
      projectedSyncPendingPulse = projectedSyncPendingPulse || Boolean(options.pulse)
      return
    }

    flushProjectedMessages(options)
  }

  const withProjectedSyncBatch = <T>(callback: () => T): T => {
    projectedSyncBatchDepth += 1

    try {
      return callback()
    } finally {
      projectedSyncBatchDepth -= 1

      if (projectedSyncBatchDepth === 0 && projectedSyncPending) {
        const shouldPulse = projectedSyncPendingPulse
        projectedSyncPending = false
        projectedSyncPendingPulse = false
        flushProjectedMessages({ pulse: shouldPulse })
      }
    }
  }

  const bindActiveRun = (runId: RunId | null) => {
    if (!runId) {
      return
    }

    state.runId = runId

    if (liveAssistantMessage && liveAssistantMessage.runId == null) {
      liveAssistantMessage.runId = runId
    }
  }

  const clonePendingWait = (
    wait: BackendPendingWait,
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait => ({
    ...wait,
    args: wait.args ? { ...wait.args } : null,
    ...(wait.ownerRunId
      ? { ownerRunId: wait.ownerRunId }
      : ownerRunId
        ? { ownerRunId: String(ownerRunId) }
        : {}),
  })

  const clonePendingWaits = (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait[] => waits.map((wait) => clonePendingWait(wait, ownerRunId))

  const setPendingWaits = (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ) => {
    state.pendingWaits = clonePendingWaits(waits, ownerRunId)
    state.waitIds = state.pendingWaits.map((wait) => wait.waitId)
  }

  const mergePendingWaitsForRun = (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait[] => {
    const ownerRunIdValue = ownerRunId ? String(ownerRunId) : null
    const merged = clonePendingWaits(waits, ownerRunId)

    for (const existingWait of state.pendingWaits) {
      if (!existingWait.ownerRunId || existingWait.ownerRunId === ownerRunIdValue) {
        continue
      }

      if (merged.some((wait) => wait.waitId === existingWait.waitId)) {
        continue
      }

      merged.push(clonePendingWait(existingWait))
    }

    return merged
  }

  const clearPendingWaits = () => {
    state.pendingWaits = []
    state.waitIds = []
  }

  const removePendingWaitBlocksFromLiveMessage = () => {
    const liveMessage = liveAssistantMessage
    if (!liveMessage) {
      return
    }
    const before = liveMessage.blocks.length
    liveMessage.blocks = liveMessage.blocks.filter(
      (block) => !(block.type === 'thinking' && block.id.startsWith('waiting:')),
    )

    if (liveMessage.blocks.length !== before) {
      syncProjectedMessages()
      state.streamPulse += 1
    }
  }

  const removePendingWaitByWaitId = (waitId: string) => {
    setPendingWaits(state.pendingWaits.filter((wait) => wait.waitId !== waitId))
    syncPendingWaitBlocks()
  }

  const removePendingWaitByCallId = (callId: string) => {
    setPendingWaits(state.pendingWaits.filter((wait) => String(wait.callId) !== callId))
    syncPendingWaitBlocks()
  }

  const upsertPendingWait = (wait: BackendPendingWait) => {
    const nextWait = clonePendingWait(wait)
    const nextWaits = clonePendingWaits(state.pendingWaits)
    const index = nextWaits.findIndex((entry) => entry.waitId === nextWait.waitId)

    if (index >= 0) {
      nextWaits[index] = nextWait
    } else {
      nextWaits.push(nextWait)
    }

    setPendingWaits(nextWaits)
    syncPendingWaitBlocks(nextWait.createdAt)
  }

  const replaceDurableMessages = (messages: UiMessage[]) => {
    logChatDebug('store', 'replaceDurableMessages:input', messages.map(summarizeMessage))
    const nextDurableMessages = messages.map((message) =>
      overlayDurableAssistantFromLive({
        ...message,
        uiKey: message.id,
      }),
    )

    if (liveAssistantMessage) {
      const activeLiveAssistant = liveAssistantMessage
      const durableAssistant = nextDurableMessages.find(
        (message) =>
          message.role === 'assistant' &&
          message.runId != null &&
          message.runId === activeLiveAssistant.runId,
      )

      if (durableAssistant) {
        rememberStableUiKey(
          durableAssistant.id,
          activeLiveAssistant.uiKey ?? activeLiveAssistant.id,
        )
      }
    }

    durableMessages = nextDurableMessages.map(withStableUiKey)
    optimisticMessages = optimisticMessages.filter(
      (message) => !durableMessages.some((durable) => durable.id === message.id),
    )
    if (liveAssistantMessage && durableHasAssistantForRun(liveAssistantMessage.runId)) {
      liveAssistantMessage = null
      liveAssistantMessageId = null
    }
    syncProjectedMessages({ pulse: true })
  }

  const clearActiveTransport = () => {
    if (activeCompletedResponseTimer) {
      clearTimeout(activeCompletedResponseTimer)
      activeCompletedResponseTimer = null
    }
    activeStreamAbortController = null
    activeStreamPromise = null
  }

  const clearRunReconcileTimer = () => {
    if (activeRunReconcileTimer) {
      clearTimeout(activeRunReconcileTimer)
      activeRunReconcileTimer = null
    }
  }

  const scheduleCompletedResponseSettle = (
    runId: RunId,
    delayMs = completedResponseStreamDrainMs,
  ) => {
    if (activeCompletedResponseTimer) {
      clearTimeout(activeCompletedResponseTimer)
    }

    activeCompletedResponseTimer = setTimeout(() => {
      activeCompletedResponseTimer = null

      if (state.runId !== runId || isTerminalRunStatus(state.runStatus)) {
        return
      }

      finalizeRun('completed', 'stop', { runId })
      activeStreamAbortController?.abort()
    }, delayMs)
  }

  const resetRunState = () => {
    clearRunReconcileTimer()
    state.isCancelling = false
    state.isReconnecting = false
    state.isResolvingWait = false
    state.resolvingWaitIds = new Set()
    state.isStreaming = false
    state.isWaiting = false
    state.runId = null
    state.runStatus = null
    clearPendingWaits()
  }

  const resetState = () => {
    clearActiveTransport()
    liveAssistantMessageId = null
    liveAssistantMessage = null
    pendingOptimisticMessageId = null
    stableUiKeyByMessageId.clear()
    projectedSyncBatchDepth = 0
    projectedSyncPending = false
    projectedSyncPendingPulse = false
    localAttachmentsByMessageId.clear()
    state.eventCursor = 0
    state.error = null
    state.isLoading = false
    state.isThreadNaming = false
    state.contextBudget = null
    state.memoryActivity = 'idle'
    state.messageEditDraft = null
    resetRunState()
    durableMessages = []
    optimisticMessages = []
    syncProjectedMessages()
    state.sessionId = null
    state.streamPulse = now()
    state.threadTitle = null
    state.threadId = null
    state.title = DEFAULT_TITLE
  }

  const stopActiveStream = async (): Promise<void> => {
    const controller = activeStreamAbortController
    const streamPromise = activeStreamPromise
    clearActiveTransport()
    controller?.abort()
    await streamPromise?.catch(() => undefined)
  }

  const finishReasonForRunStatus = (status: BackendRun['status']): MessageFinishReason | null => {
    switch (status) {
      case 'waiting':
        return 'waiting'
      case 'failed':
        return 'error'
      case 'cancelled':
        return 'cancelled'
      case 'completed':
        return 'stop'
      default:
        return null
    }
  }

  const getLiveAssistantMessageId = (): MessageId =>
    liveAssistantMessageId ?? asMessageId(`live:${state.runId ?? 'pending'}`)

  const primeLiveAssistantMessageId = (): MessageId => {
    const nextId = asMessageId(`live:${randomUUID()}`)
    liveAssistantMessageId = nextId
    return nextId
  }

  const ensureLiveAssistantMessage = (
    createdAt: string,
    expectedRunId: RunId | null = state.runId,
  ): UiMessage => {
    if (liveAssistantMessage) {
      if (expectedRunId !== null && liveAssistantMessage.runId == null) {
        liveAssistantMessage.runId = expectedRunId
      }
      logChatDebug('store', 'ensureLiveAssistantMessage:reuse', summarizeMessage(liveAssistantMessage))
      return liveAssistantMessage
    }

    const liveMessageId = getLiveAssistantMessageId()
    liveAssistantMessageId = liveMessageId

    liveAssistantMessage = {
      id: liveMessageId,
      uiKey: liveMessageId,
      role: 'assistant',
      status: state.isWaiting ? 'waiting' : 'streaming',
      createdAt,
      text: '',
      attachments: [],
      blocks: [],
      finishReason: null,
      runId: expectedRunId,
      sequence: null,
    }

    logChatDebug('store', 'ensureLiveAssistantMessage:create', summarizeMessage(liveAssistantMessage))
    syncProjectedMessages()
    return liveAssistantMessage
  }

  const ensurePendingWaitBlocks = (createdAt: string) => {
    if (state.pendingWaits.length === 0) {
      return
    }

    const liveMessage = ensureLiveAssistantMessage(createdAt)
    const toolIndex = toolIndexByMessageId.get(liveMessage.id) ?? new Map<string, number>()
    toolIndexByMessageId.set(liveMessage.id, toolIndex)
    liveMessage.blocks = mergePendingWaitBlocks(liveMessage.blocks, state.pendingWaits)
    toolIndex.clear()

    for (let index = 0; index < liveMessage.blocks.length; index += 1) {
      const block = liveMessage.blocks[index]
      if (block?.type === 'tool_interaction') {
        toolIndex.set(block.toolCallId, index)
      }
    }

    syncProjectedMessages()
  }

  const syncPendingWaitBlocks = (createdAt = nowIso()) => {
    removePendingWaitBlocksFromLiveMessage()

    if (state.pendingWaits.length === 0) {
      return
    }

    ensurePendingWaitBlocks(state.pendingWaits[0]?.createdAt ?? createdAt)
  }

  const ensureStreamingAssistantShell = (createdAt: string) => {
    const existingIndex = messageIndexById.get(getLiveAssistantMessageId())
    const liveMessage = ensureLiveAssistantMessage(createdAt)
    let changed = existingIndex === undefined

    if (liveMessage.status !== 'streaming') {
      liveMessage.status = 'streaming'
      changed = true
    }

    if (liveMessage.finishReason !== null) {
      liveMessage.finishReason = null
      changed = true
    }

    if (changed) {
      syncProjectedMessages()
      state.streamPulse += 1
    }
  }

  const hydrateAssistantTranscriptFromRunSnapshot = (run: BackendRun) => {
    if (!isRecord(run.resultJson)) {
      return
    }

    const canHydrate =
      run.status === 'waiting' || run.status === 'failed' || run.status === 'cancelled'
    if (!canHydrate) {
      return
    }

    const liveMessage = ensureLiveAssistantMessage(run.updatedAt, run.id)
    const shouldReplaceExistingBlocks =
      run.status === 'failed' || run.status === 'cancelled'

    if (!shouldReplaceExistingBlocks && liveMessage.blocks.length > 0) {
      return
    }

    liveMessage.blocks = materializePersistedAssistantBlocks(
      typeof run.resultJson.outputText === 'string' ? run.resultJson.outputText : '',
      run.updatedAt,
      run.resultJson,
    )

    const toolIndex = toolIndexByMessageId.get(liveMessage.id) ?? new Map<string, number>()
    toolIndex.clear()

    for (let index = 0; index < liveMessage.blocks.length; index += 1) {
      const block = liveMessage.blocks[index]
      if (block?.type === 'tool_interaction') {
        toolIndex.set(block.toolCallId, index)
      }
    }

    toolIndexByMessageId.set(liveMessage.id, toolIndex)
    syncProjectedMessages()
  }

  const removeLiveAssistantMessage = () => {
    if (!liveAssistantMessageId && !liveAssistantMessage) {
      return
    }
    logChatDebug(
      'store',
      'removeLiveAssistantMessage',
      liveAssistantMessage ? summarizeMessage(liveAssistantMessage) : { id: liveAssistantMessageId },
    )
    liveAssistantMessage = null
    liveAssistantMessageId = null
    syncProjectedMessages()
  }

  const releaseLiveAssistantAfterTerminal = (endedRunId: RunId) => {
    if (state.isWaiting) {
      return
    }

    const liveId =
      liveAssistantMessageId ?? asMessageId(`live:${String(endedRunId)}`)
    const liveMsg =
      liveAssistantMessage?.id === liveId
        ? liveAssistantMessage
        : null
    if (!liveMsg) {
      liveAssistantMessageId = null
      liveAssistantMessage = null
      return
    }
    if (liveMsg.role !== 'assistant' || liveMsg.runId !== endedRunId) {
      liveAssistantMessageId = null
      liveAssistantMessage = null
      return
    }

    if (durableHasAssistantForRun(endedRunId)) {
      removeLiveAssistantMessage()
      return
    }

    const hasKeepWorthyContent =
      liveMsg.text.trim().length > 0 || liveMsg.blocks.length > 0

    if (hasKeepWorthyContent) {
      return
    }

    removeLiveAssistantMessage()
  }

  const pruneLiveAssistantAfterThreadRefresh = () => {
    if (state.isWaiting) {
      return
    }

    let assistantRunId: RunId | null = null
    if (liveAssistantMessage?.role === 'assistant' && liveAssistantMessage.runId != null) {
      assistantRunId = liveAssistantMessage.runId
    }

    if (assistantRunId) {
      releaseLiveAssistantAfterTerminal(assistantRunId)
    } else {
      removeLiveAssistantMessage()
    }
  }

  const restorePersistedLiveAssistantMessage = (message: UiMessage | null) => {
    if (
      !message ||
      message.role !== 'assistant' ||
      message.runId == null ||
      durableHasAssistantForRun(message.runId)
    ) {
      return
    }

    if (state.runId != null && message.runId !== state.runId) {
      return
    }

    liveAssistantMessage = cloneUiMessage(message)
    liveAssistantMessageId = liveAssistantMessage.id
    syncProjectedMessages({ pulse: true })
  }

  const replaceMessageId = (currentId: MessageId, nextId: MessageId) => {
    logChatDebug('store', 'replaceMessageId', { currentId, nextId })
    const attachments = localAttachmentsByMessageId.get(currentId)
    if (attachments) {
      localAttachmentsByMessageId.delete(currentId)
      setLocalAttachments(nextId, attachments)
    }

    if (state.messageEditDraft?.messageId === currentId) {
      state.messageEditDraft = {
        ...state.messageEditDraft,
        messageId: nextId,
      }
    }

    const optimisticIndex = optimisticMessages.findIndex((message) => message.id === currentId)
    if (optimisticIndex === -1) {
      if (pendingOptimisticMessageId === currentId) {
        pendingOptimisticMessageId = null
      }
      return
    }

    const message = optimisticMessages[optimisticIndex]
    const stableUiKey = message.uiKey ?? message.id
    message.id = nextId
    message.uiKey = stableUiKey
    rememberStableUiKey(nextId, stableUiKey)
    message.attachments = getLocalAttachments(nextId)
    syncProjectedMessages({ pulse: true })
    if (pendingOptimisticMessageId === currentId) {
      pendingOptimisticMessageId = null
    }
  }

  const removeMessage = (messageId: MessageId) => {
    localAttachmentsByMessageId.delete(messageId)

    if (state.messageEditDraft?.messageId === messageId) {
      clearMessageEditDraft()
    }

    const optimisticIndex = optimisticMessages.findIndex((message) => message.id === messageId)
    if (optimisticIndex >= 0) {
      optimisticMessages.splice(optimisticIndex, 1)
      syncProjectedMessages()
    }

    if (liveAssistantMessageId === messageId) {
      liveAssistantMessage = null
      liveAssistantMessageId = null
      syncProjectedMessages()
    }

    if (pendingOptimisticMessageId === messageId) {
      pendingOptimisticMessageId = null
    }
  }

  const appendOptimisticUserMessage = (
    text: string,
    attachments: MessageAttachment[] = [],
  ): MessageId => {
    const token = randomUUID()
    const id = asMessageId(`tmp:${token}`)
    setLocalAttachments(id, attachments)
    const message: UiMessage = {
      id,
      uiKey: `pending-user:${token}`,
      role: 'user',
      status: 'complete',
      createdAt: nowIso(),
      text,
      attachments: getLocalAttachments(id),
      blocks: [],
      finishReason: null,
      runId: null,
      sequence: null,
    }
    optimisticMessages.push(message)
    logChatDebug('store', 'appendOptimisticUserMessage', summarizeMessage(message))
    syncProjectedMessages({ pulse: true })
    return id
  }

  const refreshThreadMessages = async () => {
    if (!state.threadId) {
      return
    }

    const messages = await listThreadMessagesImpl(state.threadId)
    replaceDurableMessages(
      messages.map((message) => toUiMessage(message, getLocalAttachments(message.id))),
    )
  }

  const refreshThreadBudget = async (threadId: ThreadId | null = state.threadId) => {
    if (!threadId) {
      return
    }

    const budget = await getThreadBudgetImpl(threadId)

    if (state.threadId !== threadId) {
      return
    }

    state.contextBudget = budget ? toContextBudget(budget) : null
  }

  const hydratePendingWaitState = (run: BackendRun) => {
    const hydratedPendingWaits =
      run.status === 'waiting' && isRecord(run.resultJson)
        ? parsePendingWaits(run.resultJson.pendingWaits)
        : []

    if (run.status === 'waiting' && hydratedPendingWaits.length > 0) {
      setPendingWaits(mergePendingWaitsForRun(hydratedPendingWaits, run.id))
      return
    }

    if (
      run.status === 'waiting' &&
      isRecord(run.resultJson) &&
      Array.isArray(run.resultJson.waitIds)
    ) {
      state.waitIds = run.resultJson.waitIds.filter(
        (waitId): waitId is string => typeof waitId === 'string',
      )
      return
    }

    clearPendingWaits()
  }

  const scheduleRunReconciliation = (runId: RunId) => {
    clearRunReconcileTimer()
    activeRunReconcileTimer = setTimeout(() => {
      activeRunReconcileTimer = null

      if (!state.runId || state.runId !== runId || isTerminalRunStatus(state.runStatus)) {
        return
      }

      void reconcileRunState(runId).catch(() => {
        if (!state.runId || state.runId !== runId || isTerminalRunStatus(state.runStatus)) {
          return
        }

        scheduleRunReconciliation(runId)
      })
    }, runReconcileDelayMs)
  }

  const syncRunStateFromBackend = async (run: BackendRun) => {
    state.error = null
    bindActiveRun(run.id)
    state.runStatus = run.status
    state.isCancelling = false
    state.isResolvingWait = false
    state.isWaiting = run.status === 'waiting'
    state.isStreaming = run.status === 'running' || run.status === 'pending'
    hydratePendingWaitState(run)
    hydrateAssistantTranscriptFromRunSnapshot(run)

    if (isTerminalRunStatus(run.status)) {
      finalizeRun(run.status, finishReasonForRunStatus(run.status), { runId: run.id })
      if (state.threadId) {
        await refreshThreadMessages().catch(() => undefined)
      }
      if (!state.isWaiting) {
        releaseLiveAssistantAfterTerminal(run.id)
      }
      return run
    }

    persistState()

    if (run.status === 'waiting') {
      ensureLiveAssistantMessage(run.updatedAt, run.id).status = 'waiting'
      ensurePendingWaitBlocks(run.updatedAt)
    }

    scheduleRunReconciliation(run.id)
    return run
  }

  const reconcileRunState = async (runId: RunId) => {
    const run = await getRunImpl(runId)
    return syncRunStateFromBackend(run)
  }

  const isPrivateChildRun = (run: BackendRun): boolean =>
    run.threadId == null && run.rootRunId !== run.id

  const resolveHydratedRun = async (run: BackendRun): Promise<BackendRun> => {
    if (!state.threadId || !isPrivateChildRun(run)) {
      return run
    }

    try {
      const rootRun = await getRunImpl(run.rootRunId)
      if (rootRun.threadId === state.threadId) {
        return rootRun
      }
    } catch {
      // Fall back to the stored run if the root run cannot be loaded.
    }

    return run
  }

  const reconcileFailedRunState = (runId: RunId | null) => {
    if (!runId) {
      return
    }

    void reconcileRunState(runId).catch(() => undefined)
  }

  const awaitStreamOutcome = async (streamPromise: Promise<void>, runId: RunId | null) => {
    try {
      await streamPromise
    } catch (error) {
      if (isAbortError(error, activeStreamAbortController?.signal)) {
        return
      }

      if (runId) {
        try {
          await reconcileRunState(runId)
          return
        } catch {
          // Fall through to surface the original stream error.
        }
      }

      throw error
    }
  }

  const eventRunId = (event: BackendEvent): RunId | null => {
    if (!('runId' in event.payload) || typeof event.payload.runId !== 'string') {
      return null
    }

    return asRunId(event.payload.runId)
  }

  const eventThreadId = (event: BackendEvent): ThreadId | null => {
    if (!('threadId' in event.payload) || typeof event.payload.threadId !== 'string') {
      return null
    }

    return asThreadId(event.payload.threadId)
  }

  const isCurrentThreadEvent = (event: BackendEvent): boolean =>
    !state.threadId || eventThreadId(event) === state.threadId

  const isChildTranscriptEvent = (event: BackendEvent): boolean => {
    switch (event.type) {
      case 'generation.completed':
      case 'progress.reported':
      case 'reasoning.summary.delta':
      case 'reasoning.summary.done':
      case 'stream.delta':
      case 'stream.done':
      case 'tool.called':
      case 'tool.confirmation_requested':
      case 'tool.confirmation_granted':
      case 'tool.confirmation_rejected':
      case 'tool.completed':
      case 'tool.failed':
      case 'tool.waiting':
      case 'wait.timed_out':
      case 'web_search.progress':
        return true
      default:
        return false
    }
  }

  const applyLiveEvent = (event: BackendEvent) => {
    logChatDebug('store', 'applyLiveEvent', {
      eventNo: event.eventNo,
      runId: eventRunId(event),
      threadId: eventThreadId(event),
      type: event.type,
    })
    const message = ensureLiveAssistantMessage(event.createdAt, eventRunId(event))
    const toolIndex = toolIndexByMessageId.get(message.id) ?? new Map<string, number>()
    toolIndexByMessageId.set(message.id, toolIndex)
    applyEvent(message.blocks, event, toolIndex)
    syncProjectedMessages()
    persistState()
    state.streamPulse += 1
  }

  const applyRunExecutionOutput = (output: {
    pendingWaits?: BackendPendingWait[]
    runId: RunId
    status: 'completed' | 'waiting'
  }, options: {
    settleDelayMs?: number
  } = {}) => {
    if (isTerminalRunStatus(state.runStatus) && state.runId === null) {
      return
    }

    bindActiveRun(output.runId)
    state.runStatus = output.status
    state.isStreaming = false
    state.isWaiting = output.status === 'waiting'

    if (output.status === 'waiting') {
      setPendingWaits(mergePendingWaitsForRun(output.pendingWaits ?? [], output.runId))
      ensurePendingWaitBlocks(output.pendingWaits?.[0]?.createdAt ?? nowIso())
      scheduleRunReconciliation(output.runId)
      persistState()
      if (state.threadId) {
        void refreshThreadBudget(state.threadId).catch(() => undefined)
      }
      return
    }

    clearPendingWaits()

    if (activeStreamAbortController && activeStreamPromise) {
      bindActiveRun(output.runId)
      state.runStatus = 'running'
      state.isStreaming = true
      state.isWaiting = false
      ensureStreamingAssistantShell(nowIso())
      scheduleRunReconciliation(output.runId)
      persistState()
      scheduleCompletedResponseSettle(output.runId, options.settleDelayMs)
      return
    }

    finalizeRun('completed', 'stop', { runId: output.runId })
    activeStreamAbortController?.abort()
  }

  const finalizeRun = (
    status: BackendRun['status'],
    finishReason: MessageFinishReason | null,
    options: { runId?: RunId | null } = {},
  ) => {
    const finalizedRunId = options.runId ?? state.runId
    if (finalizedRunId && state.runId && finalizedRunId !== state.runId) {
      logChatDebug('store', 'finalizeRun:ignoredForeignRun', {
        finalizedRunId,
        stateRunId: state.runId,
        status,
      })
      return
    }
    logChatDebug('store', 'finalizeRun:start', {
      finishReason,
      liveAssistantMessage: liveAssistantMessage ? summarizeMessage(liveAssistantMessage) : null,
      runId: state.runId,
      runStatus: state.runStatus,
      status,
    })
    if (activeCompletedResponseTimer) {
      clearTimeout(activeCompletedResponseTimer)
      activeCompletedResponseTimer = null
    }

    state.runStatus = status
    state.isStreaming = false
    state.isWaiting = status === 'waiting'
    state.isResolvingWait = false
    if (status !== 'waiting') {
      clearPendingWaits()
    }

    if (liveAssistantMessage) {
      const liveMessage = liveAssistantMessage
      liveMessage.finishReason = finishReason
      liveMessage.status =
        status === 'failed' ? 'error' : status === 'waiting' ? 'waiting' : 'complete'
      syncProjectedMessages()
    }

    if (isTerminalRunStatus(status)) {
      clearRunReconcileTimer()
      if (finalizedRunId == null || state.runId === finalizedRunId) {
        state.runId = null
      }
      persistState()
    } else {
      persistState()
      if (status === 'waiting' && state.runId) {
        scheduleRunReconciliation(state.runId)
      }
    }

    if ((status === 'completed' || status === 'waiting') && state.threadId) {
      void refreshThreadBudget(state.threadId).catch(() => undefined)
    }
    logChatDebug('store', 'finalizeRun:end', getChatStoreDebugSnapshot())
  }

  const syncForeignPendingWaitFromEvent = (event: BackendEvent) => {
    switch (event.type) {
      case 'tool.confirmation_requested':
        upsertPendingWait({
          args: event.payload.args,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          ownerRunId: String(event.payload.runId),
          requiresApproval: true,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        break

      case 'tool.waiting':
        if (event.payload.waitType !== 'human' || event.payload.waitTargetKind !== 'human_response') {
          break
        }

        upsertPendingWait({
          args: event.payload.args ?? null,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          ownerRunId: String(event.payload.runId),
          requiresApproval: false,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        break

      case 'tool.confirmation_granted':
      case 'tool.confirmation_rejected':
      case 'wait.timed_out':
        removePendingWaitByWaitId(event.payload.waitId)
        break

      case 'tool.completed':
      case 'tool.failed':
        removePendingWaitByCallId(String(event.payload.callId))
        break
    }
  }

  const ingestEvent = (event: BackendEvent): boolean => {
    logChatDebug('store', 'ingestEvent', {
      eventNo: event.eventNo,
      runId: eventRunId(event),
      stateRunId: state.runId,
      threadId: eventThreadId(event),
      type: event.type,
    })
    if (!isCurrentThreadEvent(event)) {
      return false
    }

    state.eventCursor = Math.max(state.eventCursor, event.eventNo)
    persistState()

    if (event.type === 'message.posted') {
      const postedRunId = eventRunId(event)
      if (postedRunId && durableHasAssistantForRun(postedRunId)) {
        return false
      }

      if (
        pendingOptimisticMessageId &&
        typeof event.payload.messageId === 'string' &&
        (event.payload.runId === undefined || event.payload.runId === null)
      ) {
        replaceMessageId(pendingOptimisticMessageId, asMessageId(event.payload.messageId))
      }
      void refreshThreadMessages().catch((error) => {
        state.error = toDisplayError(error, 'Failed to refresh thread messages.')
      })
      return false
    }

    if (event.type === 'run.created') {
      bindActiveRun(asRunId(String(event.payload.runId)))
      state.runStatus = 'pending'
      state.sessionId = asSessionId(String(event.payload.sessionId))
      state.threadId = asThreadId(String(event.payload.threadId))
      persistState()
      if (state.runId) {
        scheduleRunReconciliation(state.runId)
      }
      return false
    }

    const runId = eventRunId(event)
    if (state.runId == null && runId && durableHasAssistantForRun(runId)) {
      return false
    }

    const canBootstrapActiveRunFromEvent =
      runId != null &&
      state.runId == null &&
      liveAssistantMessage != null &&
      state.isStreaming &&
      event.type !== 'run.waiting' &&
      event.type !== 'run.failed' &&
      event.type !== 'run.cancelled' &&
      event.type !== 'run.completed'

    if (canBootstrapActiveRunFromEvent) {
      bindActiveRun(runId)
      persistState()
    }

    if (state.runId == null && runId) {
      return false
    }

    const isForeignRunEvent = Boolean(runId && state.runId && runId !== state.runId)
    if (isForeignRunEvent && !isChildTranscriptEvent(event)) {
      return false
    }

    if (isForeignRunEvent) {
      syncForeignPendingWaitFromEvent(event)
      applyLiveEvent(event)
      if (state.runId) {
        scheduleRunReconciliation(state.runId)
      }
      return false
    }

    switch (event.type) {
      case 'run.started':
      case 'run.resumed': {
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        clearPendingWaits()
        removePendingWaitBlocksFromLiveMessage()
        if (liveAssistantMessage) {
          liveAssistantMessage.status = 'streaming'
          liveAssistantMessage.finishReason = null
          syncProjectedMessages()
        }
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        break
      }

      case 'turn.started':
        state.contextBudget = withStreamingBudgetStart(state.contextBudget, {
          estimatedInputTokens: event.payload.estimatedInputTokens,
          reservedOutputTokens: event.payload.reservedOutputTokens,
          stablePrefixTokens: event.payload.stablePrefixTokens,
          turn: event.payload.turn,
          volatileSuffixTokens: event.payload.volatileSuffixTokens,
        })
        break

      case 'memory.observation.started':
        state.memoryActivity = 'observing'
        break

      case 'memory.observation.completed':
        state.memoryActivity = 'idle'
        break

      case 'memory.reflection.started':
        state.memoryActivity = 'reflecting'
        break

      case 'memory.reflection.completed':
        state.memoryActivity = 'idle'
        break

      case 'thread.naming.requested':
      case 'thread.naming.started':
        state.isThreadNaming = true
        persistState()
        state.streamPulse += 1
        return false

      case 'thread.updated':
        applyThreadTitle({
          title: event.payload.title,
        })
        state.isThreadNaming = false
        persistState()
        state.streamPulse += 1
        return false

      case 'thread.naming.completed':
        state.isThreadNaming = false
        persistState()
        state.streamPulse += 1
        return false

      case 'thread.naming.failed':
        state.isThreadNaming = false
        if (event.payload.trigger === 'manual_regenerate') {
          state.error = humanizeErrorMessage(event.payload.error.message)
        }
        persistState()
        state.streamPulse += 1
        return false

      case 'progress.reported':
      case 'reasoning.summary.delta':
      case 'reasoning.summary.done':
      case 'stream.done':
      case 'web_search.progress':
      case 'tool.called':
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'stream.delta':
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        state.contextBudget = withEstimatedOutputDelta(state.contextBudget, event.payload.delta)
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'generation.completed': {
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        state.contextBudget = withReconciledUsage(
          state.contextBudget,
          parseUsage(event.payload.usage),
          event.createdAt,
          event.payload.model,
          event.payload.provider,
          event.payload.outputText,
        )
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false
      }

      case 'tool.confirmation_requested':
        upsertPendingWait({
          args: event.payload.args,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          requiresApproval: true,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'tool.confirmation_granted':
      case 'tool.confirmation_rejected':
        removePendingWaitByWaitId(event.payload.waitId)
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'tool.completed':
        removePendingWaitByCallId(String(event.payload.callId))
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'tool.failed':
        removePendingWaitByCallId(String(event.payload.callId))
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'run.waiting':
        setPendingWaits(
          mergePendingWaitsForRun(event.payload.pendingWaits ?? [], runId ?? state.runId),
        )
        state.isResolvingWait = false
        applyLiveEvent(event)
        finalizeRun('waiting', 'waiting', { runId })
        return false

      case 'run.failed':
        {
          const terminalRunId = state.runId ?? runId
          applyLiveEvent(event)
          state.error = humanizeErrorMessage(event.payload.error.message)
          finalizeRun('failed', 'error', { runId: terminalRunId })
          reconcileFailedRunState(terminalRunId)
          return true
        }

      case 'run.cancelled':
        applyLiveEvent(event)
        finalizeRun('cancelled', 'cancelled', { runId })
        return true

      case 'run.completed':
        applyLiveEvent(event)
        finalizeRun('completed', 'stop', { runId })
        return true

      // Canonical domain events omitted from the original UI contract — see fails.md §4.2.
      case 'tool.waiting':
        // `applyLiveEvent` does not create a new row here, but it *does* attach the delegated
        // child run id to an existing `delegate_to_agent` block, which is required for nested
        // activity grouping.
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'wait.timed_out':
        state.runStatus = 'running'
        state.isStreaming = true
        state.isWaiting = false
        state.isResolvingWait = false
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        applyLiveEvent(event)
        return false

      case 'child_run.completed':
      case 'run.requeued':
        if (state.runId) {
          scheduleRunReconciliation(state.runId)
        }
        return false
    }

    return false
  }

  const connectThreadEventStream = (threadId: ThreadId) => {
    const controller = new AbortController()
    let streamPromise: Promise<void> | null = null
    activeStreamAbortController = controller

    streamPromise = streamThreadEventsImpl({
      cursor: state.eventCursor,
      signal: controller.signal,
      threadId,
      onReconnectStateChange(isReconnecting) {
        if (state.threadId !== threadId) return
        state.isReconnecting = isReconnecting
        state.streamPulse += 1
      },
      onEvents(events) {
        // Discard events if the stream belongs to a thread we've already left
        if (state.threadId !== threadId) {
          controller.abort()
          return
        }

        let shouldStop = false
        withProjectedSyncBatch(() => {
          for (const event of events) {
            shouldStop = ingestEvent(event) || shouldStop
            if (shouldStop) {
              break
            }
          }
        })

        if (shouldStop) {
          controller.abort()
        }
      },
    }).catch((error) => {
      if (!isAbortError(error)) {
        throw error
      }
    }).finally(() => {
      if (activeStreamPromise === streamPromise) {
        clearActiveTransport()
      }
    })

    activeStreamPromise = streamPromise
    return streamPromise
  }

  const ensureThreadEventStream = (threadId: ThreadId): Promise<void> =>
    activeStreamPromise ?? connectThreadEventStream(threadId)

  const getReplyablePendingWait = (): BackendPendingWait | null => {
    const replyableWaits = state.pendingWaits.filter(
      (wait) =>
        isReplyablePendingWait(wait) &&
        !state.resolvingWaitIds.has(wait.waitId) &&
        (state.runId == null || wait.ownerRunId == null || wait.ownerRunId === state.runId),
    )

    return replyableWaits.length === 1 ? clonePendingWait(replyableWaits[0]!) : null
  }

  const submitPendingWaitReply = async (input: {
    optimisticUserMessageId: MessageId | null
    text: string
    threadId: ThreadId
    wait: BackendPendingWait
  }) => {
    const targetRunId = input.wait.ownerRunId ? asRunId(input.wait.ownerRunId) : state.runId

    if (!targetRunId) {
      throw new Error('Replyable wait is missing an owner run id.')
    }

    state.resolvingWaitIds = new Set([...state.resolvingWaitIds, input.wait.waitId])
    state.isResolvingWait = true

    try {
      const isCurrentRunWait = state.runId != null && targetRunId === state.runId
      let streamPromise: Promise<void> | null = null

      if (isCurrentRunWait) {
        await stopActiveStream()
        streamPromise = connectThreadEventStream(input.threadId)
      } else {
        streamPromise = ensureThreadEventStream(input.threadId)
      }

      const postedMessage = await postThreadMessageImpl(input.threadId, {
        text: input.text,
      })

      state.sessionId = postedMessage.sessionId

      if (input.optimisticUserMessageId) {
        replaceMessageId(input.optimisticUserMessageId, postedMessage.messageId)
      }

      const resumeResult = await resumeRunImpl(targetRunId, {
        output: {
          content: [{ text: input.text, type: 'text' as const }],
          kind: 'human_response',
          sourceMessageId: postedMessage.messageId,
          text: input.text,
          threadId: input.threadId,
        },
        waitId: input.wait.waitId,
      })

      removePendingWaitByWaitId(input.wait.waitId)

      if (!isCurrentRunWait) {
        return
      }

      applyRunExecutionOutput(resumeResult)

      if (resumeResult.status === 'waiting') {
        activeStreamAbortController?.abort()
        return
      }

      if (streamPromise) {
        await awaitStreamOutcome(streamPromise, targetRunId)
        const thread = await getThreadImpl(input.threadId)
        applyThreadTitle(thread)
        await refreshThreadMessages()
        pruneLiveAssistantAfterThreadRefresh()
      }
    } finally {
      const next = new Set(state.resolvingWaitIds)
      next.delete(input.wait.waitId)
      state.resolvingWaitIds = next
      state.isResolvingWait = next.size > 0
      if (!state.isWaiting) {
        state.isStreaming = false
      }
      state.isReconnecting = false
    }
  }

  const loadThread = async (thread: BackendThread) => {
    state.sessionId = thread.sessionId
    state.threadId = thread.id
    applyThreadTitle(thread)
    state.isThreadNaming = false
    const [messages, budget] = await Promise.all([
      listThreadMessagesImpl(thread.id),
      getThreadBudgetImpl(thread.id).catch(() => null),
    ])
    state.contextBudget = budget ? toContextBudget(budget) : null
    replaceDurableMessages(messages.map((message) => toUiMessage(message, getLocalAttachments(message.id))))
    persistState()
  }

  return {
    get activeAgentId() {
      return state.activeAgentId
    },
    get activeAgentName() {
      return state.activeAgentName
    },
    get defaultTarget() {
      return state.defaultTarget
    },
    get defaultTargetAgentName() {
      return state.defaultTargetAgentName
    },
    get availableModels() {
      return state.availableModels
    },
    get chatModel() {
      return state.chatModel
    },
    get contextBudget() {
      return state.contextBudget
    },
    get contextWindow() {
      if (state.contextBudget?.contextWindow) {
        return state.contextBudget.contextWindow
      }

      if (!state.modelsCatalog) return null
      const model =
        state.chatModel === BACKEND_DEFAULT_MODEL_VALUE
          ? state.modelsCatalog.defaultModel
          : state.chatModel
      const alias = state.modelsCatalog.aliases.find((a) => a.model === model)
      return alias?.contextWindow ?? null
    },
    get error() {
      return state.error
    },
    get availableReasoningModes() {
      return deriveAvailableReasoningModes(state.modelsCatalog, state.chatModel)
    },
    get isCancelling() {
      return state.isCancelling
    },
    get isLoading() {
      return state.isLoading
    },
    get isThreadNaming() {
      return state.isThreadNaming
    },
    get memoryActivity() {
      return state.memoryActivity
    },
    get isReconnecting() {
      return state.isReconnecting
    },
    get isResolvingWait() {
      return state.isResolvingWait
    },
    get isStreaming() {
      return state.isStreaming
    },
    get isWaiting() {
      return state.isWaiting
    },
    get canReplyToPendingWait() {
      return getReplyablePendingWait() !== null
    },
    get canCancel() {
      return state.runStatus === 'pending' || state.runStatus === 'running' || state.runStatus === 'waiting'
    },
    get messages() {
      return state.messages
    },
    get messageEditDraft() {
      return cloneMessageEditDraft(state.messageEditDraft)
    },
    get runId() {
      return state.runId
    },
    get sessionId() {
      return state.sessionId
    },
    get streamPulse() {
      return state.streamPulse
    },
    get targetMode() {
      return state.targetMode
    },
    get threadId() {
      return state.threadId
    },
    get currentThreadTitle() {
      return state.threadTitle
    },
    get title() {
      return state.title
    },
    get pendingToolConfirmation() {
      return state.pendingWaits.find(
        (wait) => isConfirmationPendingWait(wait) && !state.resolvingWaitIds.has(wait.waitId),
      ) ?? null
    },
    get resolvingWaitIds() {
      return state.resolvingWaitIds
    },
    get waitIds() {
      return state.waitIds
    },
    get chatReasoningMode() {
      return state.chatReasoningMode
    },

    async hydrate(_historyCount = 0) {
      state.isLoading = true
      state.error = null

      try {
        await refreshAvailableModels().catch(() => undefined)
        await refreshAccountPreferencesState().catch(() => {
          clearDefaultTargetState()
        })
        await stopActiveStream()
        const persistedState = readPersistedState(storage)

        if (!persistedState?.threadId) {
          resetState()
          return
        }

        state.eventCursor = persistedState.eventCursor
        state.sessionId = persistedState.sessionId ? asSessionId(persistedState.sessionId) : null
        state.threadId = asThreadId(persistedState.threadId)
        bindActiveRun(persistedState.runId ? asRunId(persistedState.runId) : null)
        localAttachmentsByMessageId.clear()
        for (const [messageId, attachments] of Object.entries(
          persistedState.attachmentsByMessageId ?? {},
        )) {
          localAttachmentsByMessageId.set(messageId, cloneAttachments(attachments))
        }

        const thread = await getThreadImpl(state.threadId)
        await loadThread(thread)

        if (!state.runId) {
          resetRunState()
          return
        }

        const persistedRun = await getRunImpl(state.runId)
        const run = await resolveHydratedRun(persistedRun)
        bindActiveRun(run.id)
        state.runStatus = run.status
        state.isWaiting = run.status === 'waiting'
        state.isStreaming = run.status === 'running' || run.status === 'pending'
        hydratePendingWaitState(run)

        if (isTerminalRunStatus(run.status)) {
          restorePersistedLiveAssistantMessage(persistedState.liveAssistantMessage ?? null)
          hydrateAssistantTranscriptFromRunSnapshot(run)
          finalizeRun(run.status, finishReasonForRunStatus(run.status), { runId: run.id })
          if (state.threadId) {
            await refreshThreadMessages().catch(() => undefined)
          }
          if (!state.isWaiting) {
            releaseLiveAssistantAfterTerminal(run.id)
          }
          return
        }

        hydrateAssistantTranscriptFromRunSnapshot(run)
        restorePersistedLiveAssistantMessage(persistedState.liveAssistantMessage ?? null)

        if (run.status === 'waiting') {
          ensureLiveAssistantMessage(run.updatedAt, run.id).status = 'waiting'
          ensurePendingWaitBlocks(run.updatedAt)
          scheduleRunReconciliation(run.id)
          void ensureThreadEventStream(state.threadId).catch(() => undefined)
          return
        }

        scheduleRunReconciliation(run.id)
        const streamPromise = connectThreadEventStream(state.threadId)
        await awaitStreamOutcome(streamPromise, run.id)
      } catch (error) {
        state.error = toDisplayError(error, 'Failed to load the conversation.')
      } finally {
        state.isLoading = false
        state.streamPulse += 1
      }
    },

    async reset(options: { clearTargetSelection?: boolean } = {}) {
      state.error = null
      state.isLoading = false
      state.contextBudget = null
      state.threadId = null
      await stopActiveStream()
      clearPersistedState()
      if (options.clearTargetSelection) {
        clearTargetSelectionState()
      }
      resetState()
    },

    async refreshAccountPreferences() {
      try {
        await refreshAccountPreferencesState()
      } catch {
        clearDefaultTargetState()
      }
    },

    async switchToThread(thread: BackendThread) {
      if (state.threadId === thread.id) {
        return
      }

      const previousThreadId = state.threadId
      state.error = null
      state.isLoading = true
      state.threadId = null

      try {
        await stopActiveStream()
        resetState()
        state.isLoading = true
        await loadThread(thread)
      } catch (error) {
        state.error = toDisplayError(error, 'Failed to switch conversations.')
      } finally {
        state.isLoading = false
        state.streamPulse += 1
      }
    },

    async branchFromMessage(messageId: MessageId | string) {
      if (
        !state.threadId ||
        state.isLoading ||
        state.isStreaming ||
        state.isCancelling ||
        state.isWaiting
      ) {
        return false
      }

      const targetMessageId = asMessageId(String(messageId))
      const index = messageIndexById.get(targetMessageId)

      if (index === undefined) {
        return false
      }

      const message = state.messages[index]

      if (message.role !== 'assistant' || message.sequence === null || message.status !== 'complete') {
        return false
      }

      state.error = null
      state.isLoading = true

      try {
        await stopActiveStream()
        const branchedThread = await branchThreadImpl(state.threadId, {
          sourceMessageId: targetMessageId,
        })
        resetState()
        state.isLoading = true
        await loadThread(branchedThread)
        return true
      } catch (error) {
        state.error = toDisplayError(error, 'Failed to branch the conversation.')
        return false
      } finally {
        state.isLoading = false
        state.streamPulse += 1
      }
    },

    async renameCurrentThread(title: string) {
      if (!state.threadId) {
        return
      }

      const trimmedTitle = title.trim()
      if (!trimmedTitle || trimmedTitle === (state.threadTitle?.trim() ?? '')) {
        return
      }

      state.error = null

      try {
        const updatedThread = await renameThreadImpl(state.threadId, trimmedTitle)
        applyThreadTitle(updatedThread)
        state.isThreadNaming = false
        persistState()
        state.streamPulse += 1
      } catch (error) {
        state.error = toDisplayError(error, 'Failed to rename the conversation.')
      }
    },

    async regenerateCurrentThreadTitle() {
      if (
        !state.threadId ||
        state.isLoading ||
        state.isStreaming ||
        state.isCancelling ||
        state.isWaiting ||
        state.isThreadNaming
      ) {
        return
      }

      state.error = null
      state.isThreadNaming = true
      persistState()
      state.streamPulse += 1

      void ensureThreadEventStream(state.threadId).catch(() => undefined)

      try {
        await regenerateThreadTitleImpl(state.threadId)
      } catch (error) {
        state.isThreadNaming = false
        state.error = toDisplayError(error, 'Failed to regenerate the conversation name.')
        persistState()
        state.streamPulse += 1
      }
    },

    async deleteCurrentThread() {
      if (!state.threadId) {
        return
      }

      state.error = null

      try {
        await deleteThreadImpl(state.threadId)
        state.isLoading = false
        await stopActiveStream()
        clearPersistedState()
        resetState()
      } catch (error) {
        state.error = toDisplayError(error, 'Failed to delete the conversation.')
      }
    },

    beginMessageEdit(messageId: MessageId | string) {
      if (state.isLoading || state.isStreaming || state.isCancelling || state.isWaiting) {
        return false
      }

      const targetMessageId = asMessageId(String(messageId))
      const index = messageIndexById.get(targetMessageId)
      if (index === undefined) {
        return false
      }

      const message = state.messages[index]
      if (message.role !== 'user') {
        return false
      }

      state.error = null
      state.messageEditDraft = {
        activationId: randomUUID(),
        attachments: cloneAttachments(message.attachments),
        messageId: message.id,
        text: message.text,
      }
      return true
    },

    cancelMessageEdit() {
      clearMessageEditDraft()
    },

    async submit(
      prompt: string,
      attachments: MessageAttachment[] = [],
      referencedFileIds: string[] = [],
      agentSelection?: {
        agentId: string
        agentName?: string | null
      },
    ): Promise<boolean> {
      logChatDebug('store', 'submit:start', {
        activeEditMessageId: state.messageEditDraft?.messageId ?? null,
        attachmentCount: attachments.length,
        promptLength: prompt.length,
        threadId: state.threadId,
      })
      const submittedPrompt = prompt.trim()
      const activeEditDraft = cloneMessageEditDraft(state.messageEditDraft)
      const activeEditMessageId = state.messageEditDraft?.messageId ?? null
      const visiblePrompt = stripLargeTextPasteHiddenMetadata(prompt).trim()

      const fileIds = [
        ...new Set(
          [...attachments.map((attachment) => attachment.id), ...referencedFileIds]
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
      const replyablePendingWait = state.isWaiting ? getReplyablePendingWait() : null

      if (
        state.isLoading ||
        state.isStreaming ||
        (state.isWaiting && replyablePendingWait === null) ||
        (
          activeEditMessageId
            ? !submittedPrompt && fileIds.length === 0
            : !submittedPrompt
        )
      ) {
        return false
      }

      state.error = null

      if (replyablePendingWait) {
        if (!state.threadId) {
          return false
        }

        if (activeEditMessageId) {
          state.error = 'Editing a previous message is unavailable while replying to a suspended run.'
          return false
        }

        if (fileIds.length > 0) {
          state.error = 'Attachments and file references are not supported while replying to a suspended run.'
          return false
        }
      }

      const optimisticUserMessageId = activeEditMessageId
        ? null
        : appendOptimisticUserMessage(visiblePrompt, attachments)
      if (optimisticUserMessageId) {
        pendingOptimisticMessageId = optimisticUserMessageId
      }

      let conversationTarget: ReturnType<typeof resolveConversationTarget> | null = null

      if (!replyablePendingWait) {
        conversationTarget = resolveConversationTarget(agentSelection)

        if (!conversationTarget.ok) {
          state.error = conversationTarget.error
          if (optimisticUserMessageId) {
            removeMessage(optimisticUserMessageId)
          }
          return false
        }

        state.activeAgentId = conversationTarget.value.nextActiveAgentId
        state.activeAgentName = conversationTarget.value.nextActiveAgentName
        state.targetMode = conversationTarget.value.nextTargetMode
        if (isTerminalRunStatus(state.runStatus)) {
          resetRunState()
        }
        state.isStreaming = true
        state.isCancelling = false
        state.isReconnecting = false
        state.isWaiting = false
        primeLiveAssistantMessageId()
        ensureStreamingAssistantShell(nowIso())
      }

      try {
        if (replyablePendingWait && state.threadId) {
          await submitPendingWaitReply({
            optimisticUserMessageId,
            text: submittedPrompt,
            threadId: state.threadId,
            wait: replyablePendingWait,
          })
        } else if (activeEditMessageId && state.threadId && conversationTarget?.ok) {
          updateMessageEditDraft({
            attachments,
            messageId: activeEditMessageId,
            text: visiblePrompt,
          })

          await editThreadMessageImpl(state.threadId, activeEditMessageId, {
            fileIds,
            ...(submittedPrompt ? { text: submittedPrompt } : {}),
          })
          setLocalAttachments(activeEditMessageId, attachments)
          clearMessageEditDraft()
          await refreshThreadMessages()

          const streamPromise = connectThreadEventStream(state.threadId)
          const interaction = await startThreadInteractionImpl(state.threadId, {
            messageId: activeEditMessageId,
            ...requestedModelSelection(),
            ...(requestedReasoning() ? { reasoning: requestedReasoning() } : {}),
            ...(conversationTarget.value.target ? { target: conversationTarget.value.target } : {}),
          })
          state.sessionId = interaction.sessionId
          if (!isTerminalRunStatus(state.runStatus)) {
            bindActiveRun(interaction.runId)
            state.runStatus = interaction.status === 'waiting' ? 'waiting' : 'running'
          }
          applyRunExecutionOutput(interaction)
          await awaitStreamOutcome(streamPromise, interaction.runId)
        } else if (!state.threadId && conversationTarget?.ok) {
          const createdSession = await createSessionImpl({})
          const createdThread = await createSessionThreadImpl(createdSession.id, {})

          state.sessionId = createdSession.id
          state.threadId = createdThread.id
          applyThreadTitle(createdThread)
          persistState()

          const streamPromise = connectThreadEventStream(createdThread.id)
          const interaction = await startThreadInteractionImpl(createdThread.id, {
            ...(fileIds.length > 0 ? { fileIds } : {}),
            ...requestedModelSelection(),
            ...(requestedReasoning() ? { reasoning: requestedReasoning() } : {}),
            ...(conversationTarget.value.target ? { target: conversationTarget.value.target } : {}),
            text: submittedPrompt,
          })

          state.sessionId = interaction.sessionId
          if (optimisticUserMessageId) {
            replaceMessageId(optimisticUserMessageId, interaction.inputMessageId)
          }
          if (!isTerminalRunStatus(state.runStatus)) {
            bindActiveRun(interaction.runId)
            state.runStatus = interaction.status === 'waiting' ? 'waiting' : 'running'
          }
          applyRunExecutionOutput(interaction)
          await awaitStreamOutcome(streamPromise, interaction.runId)
        } else if (state.threadId && conversationTarget?.ok) {
          const streamPromise = connectThreadEventStream(state.threadId)
          const interaction = await startThreadInteractionImpl(state.threadId, {
            ...(fileIds.length > 0 ? { fileIds } : {}),
            ...requestedModelSelection(),
            ...(requestedReasoning() ? { reasoning: requestedReasoning() } : {}),
            ...(conversationTarget.value.target ? { target: conversationTarget.value.target } : {}),
            text: submittedPrompt,
          })
          state.sessionId = interaction.sessionId
          if (optimisticUserMessageId) {
            replaceMessageId(optimisticUserMessageId, interaction.inputMessageId)
          }
          if (!isTerminalRunStatus(state.runStatus)) {
            bindActiveRun(interaction.runId)
            state.runStatus = interaction.status === 'waiting' ? 'waiting' : 'running'
          }
          applyRunExecutionOutput(interaction)
          await awaitStreamOutcome(streamPromise, interaction.runId)
        } else {
          return false
        }

        if (state.threadId) {
          const thread = await getThreadImpl(state.threadId)
          applyThreadTitle(thread)
          await refreshThreadMessages()
          pruneLiveAssistantAfterThreadRefresh()
        }

        return true
      } catch (error) {
        if (!isAbortError(error, activeStreamAbortController?.signal)) {
          state.error = toDisplayError(error, 'Message could not be sent. Try again.')
        }
        const shouldDropPendingOptimisticMessage =
          optimisticUserMessageId != null &&
          pendingOptimisticMessageId === optimisticUserMessageId
        if (shouldDropPendingOptimisticMessage) {
          pendingOptimisticMessageId = null
        }
        await stopActiveStream().catch(() => undefined)
        if (state.threadId) {
          await refreshThreadMessages().catch(() => undefined)
          pruneLiveAssistantAfterThreadRefresh()
          if (shouldDropPendingOptimisticMessage && optimisticUserMessageId) {
            removeMessage(optimisticUserMessageId)
          }
        } else {
          if (optimisticUserMessageId) {
            removeMessage(optimisticUserMessageId)
          }
          removeLiveAssistantMessage()
        }
        if (activeEditMessageId) {
          if (activeEditDraft?.messageId === activeEditMessageId) {
            state.messageEditDraft = {
              ...activeEditDraft,
              attachments: cloneAttachments(attachments),
              text: visiblePrompt,
            }
          } else {
            updateMessageEditDraft({
              attachments,
              messageId: activeEditMessageId,
              text: visiblePrompt,
            })
          }
        }
        resetRunState()
        persistState()
        return false
      } finally {
        if (!state.isWaiting) {
          state.isStreaming = false
        }
        state.isCancelling = false
        state.isReconnecting = false
        state.streamPulse += 1
        clearActiveTransport()
      }
    },

    async cancel() {
      if (!state.runId || state.isCancelling) {
        return
      }

      const cancellableStatuses: Array<BackendRun['status'] | null> = ['pending', 'running', 'waiting']
      if (!cancellableStatuses.includes(state.runStatus)) {
        return
      }

      state.error = null
      state.isCancelling = true

      const runId = state.runId
      const threadId = state.threadId

      try {
        await cancelRunImpl(runId)

        if (threadId) {
          await refreshThreadMessages().catch(() => undefined)
        }

        try {
          await reconcileRunState(runId)
        } catch {
          // GET /runs/:id may fail transiently; fall through to local finalize.
        }

        if (!isTerminalRunStatus(state.runStatus)) {
          finalizeRun('cancelled', 'cancelled', { runId })
        }

        activeStreamAbortController?.abort()
      } catch (error) {
        try {
          if (state.runId) {
            await reconcileRunState(state.runId)
            return
          }
        } catch {
          // Fall through to surface the original cancellation error.
        }

        state.error = toDisplayError(error, 'Could not stop the current run. Try again.')
      } finally {
        state.isCancelling = false
        state.streamPulse += 1
      }
    },

	    async approvePendingWait(waitId?: string, ownerRunId?: RunId | string) {
	      const targetWaitId =
	        waitId ??
	        state.pendingWaits.find((wait) => isConfirmationPendingWait(wait) && !state.resolvingWaitIds.has(wait.waitId))?.waitId ??
	        state.waitIds.find((id) => !state.resolvingWaitIds.has(id))
	      const targetRunId = ownerRunId ? asRunId(String(ownerRunId)) : state.runId
	      if (!targetRunId || !state.threadId || !targetWaitId || state.resolvingWaitIds.has(targetWaitId)) {
	        return
	      }

      state.error = null
      state.resolvingWaitIds = new Set([...state.resolvingWaitIds, targetWaitId])
	      state.isResolvingWait = true

	      try {
	        const runId = targetRunId
	        const threadId = state.threadId
	        const isCurrentRunWait = state.runId != null && runId === state.runId
	        let streamPromise: Promise<void> | null = null
	        if (isCurrentRunWait) {
	          await stopActiveStream()
	          streamPromise = connectThreadEventStream(threadId)
	        } else {
	          streamPromise = ensureThreadEventStream(threadId)
	        }
	        const resumeResult = await resumeRunImpl(runId, {
	          approve: true,
	          rememberApproval: false,
	          waitId: targetWaitId,
	        })

	        if (isCurrentRunWait) {
	          applyRunExecutionOutput(resumeResult)
	        }

	        if (isCurrentRunWait && resumeResult.status === 'waiting') {
	          activeStreamAbortController?.abort()
	        } else if (isCurrentRunWait && streamPromise) {
	          await awaitStreamOutcome(streamPromise, runId)
	          const thread = await getThreadImpl(threadId)
	          applyThreadTitle(thread)
	          await refreshThreadMessages()
	          pruneLiveAssistantAfterThreadRefresh()
	        }
	      } catch (error) {
	        state.error = toDisplayError(error, 'Could not approve the pending tool call.')
      } finally {
        const next = new Set(state.resolvingWaitIds)
        next.delete(targetWaitId)
        state.resolvingWaitIds = next
        state.isResolvingWait = next.size > 0
        if (!state.isWaiting) {
          state.isStreaming = false
	        }
	        state.isReconnecting = false
	        state.streamPulse += 1
	        if (!ownerRunId || (state.runId != null && ownerRunId === state.runId)) {
	          clearActiveTransport()
	        }
	      }
	    },

	    async trustPendingWait(waitId?: string, ownerRunId?: RunId | string) {
	      const targetWaitId =
	        waitId ??
	        state.pendingWaits.find((wait) => isConfirmationPendingWait(wait) && !state.resolvingWaitIds.has(wait.waitId))?.waitId ??
	        state.waitIds.find((id) => !state.resolvingWaitIds.has(id))
	      const targetRunId = ownerRunId ? asRunId(String(ownerRunId)) : state.runId
	      if (!targetRunId || !state.threadId || !targetWaitId || state.resolvingWaitIds.has(targetWaitId)) {
	        return
	      }

      state.error = null
      state.resolvingWaitIds = new Set([...state.resolvingWaitIds, targetWaitId])
	      state.isResolvingWait = true

	      try {
	        const runId = targetRunId
	        const threadId = state.threadId
	        const isCurrentRunWait = state.runId != null && runId === state.runId
	        let streamPromise: Promise<void> | null = null
	        if (isCurrentRunWait) {
	          await stopActiveStream()
	          streamPromise = connectThreadEventStream(threadId)
	        } else {
	          streamPromise = ensureThreadEventStream(threadId)
	        }
	        const resumeResult = await resumeRunImpl(runId, {
	          approve: true,
	          rememberApproval: true,
	          waitId: targetWaitId,
	        })

	        if (isCurrentRunWait) {
	          applyRunExecutionOutput(resumeResult)
	        }

	        if (isCurrentRunWait && resumeResult.status === 'waiting') {
	          activeStreamAbortController?.abort()
	        } else if (isCurrentRunWait && streamPromise) {
	          await awaitStreamOutcome(streamPromise, runId)
	          const thread = await getThreadImpl(threadId)
	          applyThreadTitle(thread)
	          await refreshThreadMessages()
	          pruneLiveAssistantAfterThreadRefresh()
	        }
	      } catch (error) {
	        state.error = toDisplayError(error, 'Could not trust and approve the pending tool call.')
      } finally {
        const next = new Set(state.resolvingWaitIds)
        next.delete(targetWaitId)
        state.resolvingWaitIds = next
        state.isResolvingWait = next.size > 0
        if (!state.isWaiting) {
          state.isStreaming = false
	        }
	        state.isReconnecting = false
	        state.streamPulse += 1
	        if (!ownerRunId || (state.runId != null && ownerRunId === state.runId)) {
	          clearActiveTransport()
	        }
	      }
	    },

	    async rejectPendingWait(waitId?: string, ownerRunId?: RunId | string) {
	      const targetWaitId =
	        waitId ??
	        state.pendingWaits.find((wait) => isConfirmationPendingWait(wait) && !state.resolvingWaitIds.has(wait.waitId))?.waitId ??
	        state.waitIds.find((id) => !state.resolvingWaitIds.has(id))
	      const targetRunId = ownerRunId ? asRunId(String(ownerRunId)) : state.runId
	      if (!targetRunId || !state.threadId || !targetWaitId || state.resolvingWaitIds.has(targetWaitId)) {
	        return
	      }

      state.error = null
      state.resolvingWaitIds = new Set([...state.resolvingWaitIds, targetWaitId])
	      state.isResolvingWait = true

	      try {
	        const runId = targetRunId
	        const threadId = state.threadId
	        const isCurrentRunWait = state.runId != null && runId === state.runId
	        let streamPromise: Promise<void> | null = null
	        if (isCurrentRunWait) {
	          await stopActiveStream()
	          streamPromise = connectThreadEventStream(threadId)
	        } else {
	          streamPromise = ensureThreadEventStream(threadId)
	        }
	        const resumeResult = await resumeRunImpl(runId, {
	          approve: false,
	          waitId: targetWaitId,
	        })

	        if (isCurrentRunWait) {
	          applyRunExecutionOutput(resumeResult)
	        }

	        if (isCurrentRunWait && resumeResult.status === 'waiting') {
	          activeStreamAbortController?.abort()
	        } else if (isCurrentRunWait && streamPromise) {
	          await awaitStreamOutcome(streamPromise, runId)
	          const thread = await getThreadImpl(threadId)
	          applyThreadTitle(thread)
	          await refreshThreadMessages()
	          pruneLiveAssistantAfterThreadRefresh()
	        }
	      } catch (error) {
	        state.error = toDisplayError(error, 'Could not reject the pending tool call.')
      } finally {
        const next = new Set(state.resolvingWaitIds)
        next.delete(targetWaitId)
        state.resolvingWaitIds = next
        state.isResolvingWait = next.size > 0
        if (!state.isWaiting) {
          state.isStreaming = false
	        }
	        state.isReconnecting = false
	        state.streamPulse += 1
	        if (!ownerRunId || (state.runId != null && ownerRunId === state.runId)) {
	          clearActiveTransport()
	        }
	      }
	    },

    clearError() {
      state.error = null
    },

    setTargetMode(mode: ConversationTargetMode) {
      state.error = null
      state.targetMode = mode
    },

    setTargetAgent(input: { agentId: string; agentName?: string | null }) {
      state.error = null
      state.activeAgentId = input.agentId.trim() || null
      state.activeAgentName = input.agentName?.trim() || null
      state.targetMode = 'agent'
    },

    setChatModel(model: ChatModel) {
      state.chatModel = model
      reconcileReasoningMode()
    },

    setChatReasoningMode(mode: ChatReasoningMode) {
      state.chatReasoningMode = mode
    },

    dispose() {
      clearRunReconcileTimer()
      void stopActiveStream().catch(() => undefined)
    },
  }
}

export const chatStore = createChatStore()
