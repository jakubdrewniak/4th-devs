export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageStatus = 'complete' | 'streaming' | 'waiting' | 'error'
export type MessageFinishReason = 'stop' | 'cancelled' | 'error' | 'waiting'
export const BACKEND_DEFAULT_MODEL = 'default' as const
export const BACKEND_DEFAULT_REASONING = 'default' as const
export type ChatModel = typeof BACKEND_DEFAULT_MODEL | 'gpt-4.1' | 'gpt-5.4' | (string & {})
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ReasoningSummary = 'auto' | 'concise' | 'detailed'
export type ChatReasoningMode = typeof BACKEND_DEFAULT_REASONING | ReasoningEffort | (string & {})
export type ProviderName = 'openai' | 'google'
export type WebSearchStatus = 'in_progress' | 'searching' | 'completed' | 'failed'
export type ThreadNamingTrigger = 'auto_first_message' | 'manual_regenerate'
export type ThreadTitleSource = 'manual' | ThreadNamingTrigger

export interface WebSearchReference {
  domain: string | null
  title: string | null
  url: string
}

export interface ToolAppsMeta {
  csp?: Record<string, unknown> | null
  permissions?: Record<string, unknown> | null
  resourceUri: string
  serverId: string
}

declare const idBrand: unique symbol

type BrandedId<TBrand extends string> = string & { readonly [idBrand]: TBrand }

const brandId = <TBrand extends string>(value: string): BrandedId<TBrand> =>
  value as BrandedId<TBrand>

export type SessionId = BrandedId<'SessionId'>
export type ThreadId = BrandedId<'ThreadId'>
export type MessageId = BrandedId<'MessageId'>
export type RunId = BrandedId<'RunId'>
export type EventId = BrandedId<'EventId'>
export type ToolCallId = BrandedId<'ToolCallId'>
export type ArtifactId = BrandedId<'ArtifactId'>
export type FileId = BrandedId<'FileId'>
export type UploadId = BrandedId<'UploadId'>
export type AgentId = BrandedId<'AgentId'>
export type ToolProfileId = BrandedId<'ToolProfileId'>

export const asSessionId = (value: string): SessionId => brandId<'SessionId'>(value)
export const asThreadId = (value: string): ThreadId => brandId<'ThreadId'>(value)
export const asMessageId = (value: string): MessageId => brandId<'MessageId'>(value)
export const asRunId = (value: string): RunId => brandId<'RunId'>(value)
export const asEventId = (value: string): EventId => brandId<'EventId'>(value)
export const asToolCallId = (value: string): ToolCallId => brandId<'ToolCallId'>(value)
export const asArtifactId = (value: string): ArtifactId => brandId<'ArtifactId'>(value)
export const asFileId = (value: string): FileId => brandId<'FileId'>(value)
export const asUploadId = (value: string): UploadId => brandId<'UploadId'>(value)
export const asAgentId = (value: string): AgentId => brandId<'AgentId'>(value)
export const asToolProfileId = (value: string): ToolProfileId => brandId<'ToolProfileId'>(value)

export interface ApiMeta {
  requestId: string
  traceId: string
}

export interface ApiSuccessEnvelope<TData> {
  data: TData
  meta: ApiMeta
  ok: true
}

export interface ApiErrorEnvelope {
  error: {
    message: string
    type: string
  }
  meta: ApiMeta
  ok: false
}

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope

export interface BackendModelAlias {
  alias: string
  configured: boolean
  contextWindow: number
  isDefault: boolean
  model: string
  provider: ProviderName
  reasoningModes: ReasoningEffort[]
  supportsReasoning: boolean
}

export interface BackendReasoningMode {
  effort: ReasoningEffort
  label: string
}

export interface ReasoningOptions {
  effort: ReasoningEffort
  summary?: ReasoningSummary
}

export interface BackendModelsCatalog {
  aliases: BackendModelAlias[]
  defaultAlias: string
  defaultModel: string
  defaultProvider: ProviderName
  providers: Record<
    ProviderName,
    {
      configured: boolean
      defaultModel: string
    }
  >
  reasoningModes: BackendReasoningMode[]
}

export type AgentKind = 'primary' | 'specialist' | 'derived'
export type AgentStatus = 'active' | 'archived' | 'deleted'
export type AgentVisibility = 'account_private' | 'tenant_shared' | 'system'
export type ToolProfileScope = 'account_private' | 'tenant_shared' | 'system'
export type ToolProfileStatus = 'active' | 'archived' | 'deleted'

export interface AgentReasoningConfigInput {
  effort: ReasoningEffort
}

export interface AgentModelConfigInput {
  modelAlias: string
  provider: ProviderName
  reasoning?: AgentReasoningConfigInput
}

export interface AgentToolsConfigInput {
  toolProfileId?: ToolProfileId | string | null
  native?: string[]
}

export type ConversationTargetInput =
  | {
      kind: 'assistant'
    }
  | {
      agentId: AgentId | string
      kind: 'agent'
    }

export type DefaultConversationTarget =
  | {
      kind: 'assistant'
    }
  | {
      agentId: AgentId
      kind: 'agent'
    }

export interface BackendAccountPreferences {
  accountId: string
  assistantToolProfileId: ToolProfileId
  defaultTarget: DefaultConversationTarget
  updatedAt: string
}

export interface BackendToolProfile {
  accountId: string | null
  createdAt: string
  id: ToolProfileId
  name: string
  scope: ToolProfileScope
  status: ToolProfileStatus
  tenantId: string
  updatedAt: string
}

export interface CreateToolProfileInput {
  name: string
  scope: Extract<ToolProfileScope, 'account_private' | 'tenant_shared'>
}

export interface UpdateToolProfileInput {
  name?: string
  scope?: Extract<ToolProfileScope, 'account_private' | 'tenant_shared'>
  status?: Extract<ToolProfileStatus, 'active' | 'archived'>
}

export interface UpdateAccountPreferencesInput {
  assistantToolProfileId?: ToolProfileId | string
  defaultTarget?: ConversationTargetInput
}

export interface AgentSubagentConfigInput {
  alias: string
  mode: 'async_join'
  slug: string
}

export interface CreateAgentApiInput {
  description?: string
  instructionsMd: string
  kind: AgentKind
  model?: AgentModelConfigInput
  name: string
  slug: string
  subagents?: AgentSubagentConfigInput[]
  tools?: AgentToolsConfigInput
  visibility: AgentVisibility
}

export interface UpdateAgentApiInput extends CreateAgentApiInput {
  revisionId: string
}

export interface BackendAgentSummary {
  activeRevisionId: string | null
  activeRevisionVersion: number | null
  createdAt: string
  description: string | null
  id: AgentId
  isDefaultForAccount: boolean
  kind: AgentKind
  name: string
  ownerAccountId: string | null
  slug: string
  status: AgentStatus
  updatedAt: string
  visibility: AgentVisibility
}

export interface BackendAgentDetail extends BackendAgentSummary {
  activeRevision: null | {
    checksumSha256: string
    createdAt: string
    createdByAccountId?: string | null
    frontmatterJson?: Record<string, unknown>
    id: string
    instructionsMd: string
    memoryPolicyJson?: Record<string, unknown>
    modelConfigJson: Record<string, unknown>
    resolvedConfigJson?: Record<string, unknown>
    sourceMarkdown: string
    toolProfileId?: ToolProfileId | null
    toolPolicyJson: Record<string, unknown>
    version: number
    workspacePolicyJson?: Record<string, unknown>
  }
  subagents: Array<{
    alias: string
    childAgentId: AgentId
    childDescription: string | null
    childName: string
    childSlug: string
    delegationMode: string
    position: number
  }>
}

export interface ThreadMessageContentPart {
  text: string
  type: 'text'
}

export interface BackendThreadMessage {
  authorAccountId: string | null
  authorKind: MessageRole
  content: ThreadMessageContentPart[]
  createdAt: string
  id: MessageId
  metadata: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: SessionId
  tenantId: string
  threadId: ThreadId
}

export type ThreadActivityState = 'idle' | 'pending' | 'running' | 'waiting' | 'approval' | 'failed' | 'completed'

export interface BackendThreadRootJob {
  id: string
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'cancelled' | 'superseded'
}

export interface BackendThread {
  branchFromMessageId?: MessageId | null
  branchFromSequence?: number | null
  createdAt: string
  createdByAccountId: string | null
  id: ThreadId
  parentThreadId: ThreadId | null
  rootJob?: BackendThreadRootJob | null
  sessionId: SessionId
  status: 'active' | 'merged' | 'archived' | 'deleted'
  tenantId: string
  title: string | null
  titleSource?: ThreadTitleSource | null
  updatedAt: string
}

export interface BackendSession {
  archivedAt: string | null
  createdAt: string
  createdByAccountId: string | null
  deletedAt: string | null
  id: SessionId
  metadata: Record<string, unknown> | null
  rootRunId: RunId | null
  status: 'active' | 'archived' | 'deleted'
  tenantId: string
  title: string | null
  updatedAt: string
  workspaceRef: string | null
}

export type FileAccessScope = 'session_local' | 'account_library'
export type BackendFileStatus = 'ready' | 'processing' | 'failed' | 'deleted' | (string & {})

export interface BackendFileSummary {
  accessScope: FileAccessScope
  contentUrl: string
  createdAt: string
  id: FileId
  mimeType: string | null
  originalFilename: string
  sizeBytes: number
  sourceKind: string
  status: BackendFileStatus
  title: string | null
}

export type UploadedBackendFileSummary = Omit<BackendFileSummary, 'sourceKind'> & {
  sourceKind?: string
  uploadId: UploadId
}

export interface BackendFilePickerResult {
  accessScope: FileAccessScope | null
  depth: number
  extension: string | null
  fileId: FileId | null
  label: string
  matchIndices: number[]
  mentionText: string
  mimeType: string | null
  relativePath: string
  sizeBytes: number | null
  source: 'attachment' | 'workspace'
}

export interface BackendRun {
  actorAccountId?: string | null
  completedAt: string | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  errorJson: unknown | null
  id: RunId
  lastProgressAt: string | null
  parentRunId: RunId | null
  resultJson: unknown | null
  rootRunId: RunId
  sessionId: SessionId
  sourceCallId: string | null
  startedAt: string | null
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  task: string
  tenantId: string
  targetKind?: 'assistant' | 'agent'
  threadId: ThreadId | null
  toolProfileId?: ToolProfileId | null
  turnCount: number
  updatedAt: string
  version: number
  workspaceRef: string | null
}

export interface CreateSessionInput {
  metadata?: Record<string, unknown> | null
  title?: string | null
  workspaceRef?: string | null
}

export type CreateSessionOutput = BackendSession

export interface CreateSessionThreadInput {
  parentThreadId?: ThreadId | string | null
  title?: string | null
}

export type CreateSessionThreadOutput = BackendThread

export interface BranchThreadInput {
  sourceMessageId: MessageId | string
  title?: string | null
}

export type BranchThreadOutput = BackendThread

export interface BootstrapSessionInput extends ExecuteRunInput {
  initialMessage: string
  metadata?: Record<string, unknown> | null
  task?: string
  target?: ConversationTargetInput
  threadTitle?: string | null
  title?: string | null
  workspaceRef?: string | null
}

export type BootstrapSessionOutput = RunExecutionOutput & {
  inputMessageId: MessageId
  sessionId: SessionId
  threadId: ThreadId
}

export interface ExecuteRunInput {
  maxOutputTokens?: number
  model?: string
  modelAlias?: string
  provider?: ProviderName
  reasoning?: ReasoningOptions
  temperature?: number
}

export interface BackendUsage {
  cachedTokens?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  totalTokens?: number | null
}

export interface CompletedRunExecutionOutput {
  assistantItemId: string | null
  assistantMessageId: MessageId | null
  model: string
  outputText: string
  provider: ProviderName
  responseId: string | null
  runId: RunId
  status: 'completed'
  usage: BackendUsage | null
}

export interface BackendPendingWait {
  args: Record<string, unknown> | null
  callId: ToolCallId | string
  createdAt: string
  description: string | null
  ownerRunId?: string
  requiresApproval?: boolean
  targetKind: string
  targetRef: string | null
  tool: string
  type: string
  waitId: string
}

export interface WaitingRunExecutionOutput {
  assistantItemId: null
  assistantMessageId: null
  model: string
  outputText: string
  pendingWaits: BackendPendingWait[]
  provider: ProviderName
  responseId: string | null
  runId: RunId
  status: 'waiting'
  usage: BackendUsage | null
  waitIds: string[]
}

export type RunExecutionOutput = CompletedRunExecutionOutput | WaitingRunExecutionOutput

export interface StartThreadInteractionInput extends ExecuteRunInput {
  content?: ThreadMessageContentPart[]
  fileIds?: Array<FileId | string>
  messageId?: MessageId | string
  metadata?: Record<string, unknown> | null
  task?: string
  target?: ConversationTargetInput
  text?: string
}

export interface EditThreadMessageInput {
  content?: ThreadMessageContentPart[]
  fileIds: Array<FileId | string>
  metadata?: Record<string, unknown> | null
  text?: string
}

export interface EditThreadMessageOutput {
  attachedFileIds: FileId[]
  messageId: MessageId
  sessionId: SessionId
  threadId: ThreadId
}

export interface PostThreadMessageInput {
  content?: ThreadMessageContentPart[]
  metadata?: Record<string, unknown> | null
  text?: string
}

export interface PostThreadMessageOutput {
  messageId: MessageId
  sequence: number
  sessionId: SessionId
  threadId: ThreadId
}

export type StartThreadInteractionOutput = RunExecutionOutput & {
  attachedFileIds: FileId[]
  inputMessageId: MessageId
  sessionId: SessionId
  threadId: ThreadId
}

interface BaseBackendEvent<TType extends string, TPayload> {
  actorAccountId?: string
  aggregateId: string
  aggregateType: string
  causationId?: string
  createdAt: string
  eventNo: number
  id: EventId
  payload: TPayload
  tenantId?: string
  traceId?: string
  type: TType
}

interface RunScopedPayload {
  runId: RunId | string
  sessionId: SessionId | string
  status?: string
  threadId: ThreadId | string | null
}

export type RunCreatedEvent = BaseBackendEvent<'run.created', RunScopedPayload>
export type RunStartedEvent = BaseBackendEvent<'run.started', RunScopedPayload>
export type RunResumedEvent = BaseBackendEvent<'run.resumed', RunScopedPayload & { waitId: string }>
export type TurnStartedEvent = BaseBackendEvent<
  'turn.started',
  RunScopedPayload & {
    estimatedInputTokens: number
    observationCount: number
    pendingWaitCount: number
    reservedOutputTokens: number | null
    stablePrefixTokens: number
    summaryId: string | null
    turn: number
    volatileSuffixTokens: number
  }
>
export type ProgressReportedEvent = BaseBackendEvent<
  'progress.reported',
  RunScopedPayload & {
    detail?: string
    percent?: number
    stage: string
    turn: number
  }
>
export type StreamDeltaEvent = BaseBackendEvent<
  'stream.delta',
  RunScopedPayload & {
    delta: string
    model?: string
    provider?: string
    responseId?: string | null
    turn: number
  }
>
export type StreamDoneEvent = BaseBackendEvent<
  'stream.done',
  RunScopedPayload & {
    model: string
    provider: string
    responseId: string | null
    text: string
    turn: number
  }
>
export type ReasoningSummaryDeltaEvent = BaseBackendEvent<
  'reasoning.summary.delta',
  RunScopedPayload & {
    delta: string
    itemId: string
    text: string
    turn: number
  }
>
export type ReasoningSummaryDoneEvent = BaseBackendEvent<
  'reasoning.summary.done',
  RunScopedPayload & {
    itemId: string
    text: string
    turn: number
  }
>
export type GenerationCompletedEvent = BaseBackendEvent<
  'generation.completed',
  RunScopedPayload & {
    model: string
    outputItemCount: number
    outputText: string
    provider: string
    providerRequestId: string | null
    responseId: string | null
    status: string
    toolCallCount: number
    turn: number
    usage: BackendUsage | null
  }
>
export type WebSearchProgressEvent = BaseBackendEvent<
  'web_search.progress',
  RunScopedPayload & {
    patterns: string[]
    provider: ProviderName
    queries: string[]
    references: WebSearchReference[]
    responseId: string | null
    searchId: string
    status: WebSearchStatus
    targetUrls: string[]
    turn: number
  }
>
export type ToolCalledEvent = BaseBackendEvent<
  'tool.called',
  {
    appsMeta?: ToolAppsMeta | null
    args: Record<string, unknown> | null
    callId: ToolCallId | string
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>
export type ToolConfirmationRequestedEvent = BaseBackendEvent<
  'tool.confirmation_requested',
  {
    args: Record<string, unknown> | null
    callId: ToolCallId | string
    description: string | null
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitType: string
  }
>
export type ToolConfirmationGrantedEvent = BaseBackendEvent<
  'tool.confirmation_granted',
  {
    callId: ToolCallId | string
    fingerprint?: string
    remembered: boolean
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
  }
>
export type ToolConfirmationRejectedEvent = BaseBackendEvent<
  'tool.confirmation_rejected',
  {
    callId: ToolCallId | string
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
  }
>
export type ToolCompletedEvent = BaseBackendEvent<
  'tool.completed',
  {
    appsMeta?: ToolAppsMeta | null
    callId: ToolCallId | string
    outcome: unknown
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>
export type ToolFailedEvent = BaseBackendEvent<
  'tool.failed',
  {
    appsMeta?: ToolAppsMeta | null
    callId: ToolCallId | string
    error: unknown
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>
export type MessagePostedEvent = BaseBackendEvent<
  'message.posted',
  {
    messageId: MessageId | string
    runId?: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string
  }
>
export type ThreadUpdatedEvent = BaseBackendEvent<
  'thread.updated',
  {
    sessionId: SessionId | string
    threadId: ThreadId | string
    title: string | null
    titleSource?: ThreadTitleSource | null
    updatedAt?: string
  }
>
export type ThreadNamingRequestedEvent = BaseBackendEvent<
  'thread.naming.requested',
  {
    requestId: string
    requestedAt: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>
export type ThreadNamingStartedEvent = BaseBackendEvent<
  'thread.naming.started',
  {
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>
export type ThreadNamingCompletedEvent = BaseBackendEvent<
  'thread.naming.completed',
  {
    applied: boolean
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    title: string | null
    titleSource?: ThreadTitleSource | null
    trigger: ThreadNamingTrigger
  }
>
export type ThreadNamingFailedEvent = BaseBackendEvent<
  'thread.naming.failed',
  {
    error: {
      message: string
      type: string
    }
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>
export type RunCompletedEvent = BaseBackendEvent<
  'run.completed',
  RunScopedPayload & {
    outputText: string
  }
>
export type RunWaitingEvent = BaseBackendEvent<
  'run.waiting',
  RunScopedPayload & {
    pendingWaits: BackendPendingWait[]
    waitIds: string[]
  }
>
export type RunFailedEvent = BaseBackendEvent<
  'run.failed',
  RunScopedPayload & {
    error: {
      message: string
      type: string
    }
  }
>
export type RunCancelledEvent = BaseBackendEvent<
  'run.cancelled',
  RunScopedPayload & {
    reason: string | null
  }
>
/** Non-human tool waits (external / MCP / child-run) — distinct from `tool.confirmation_requested`. */
export type ToolWaitingEvent = BaseBackendEvent<
  'tool.waiting',
  RunScopedPayload & {
    args?: Record<string, unknown> | null
    callId: ToolCallId | string
    description: string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitTargetRunId?: RunId | string
    waitType: string
  }
>
export type WaitTimedOutEvent = BaseBackendEvent<
  'wait.timed_out',
  RunScopedPayload & {
    callId: ToolCallId | string
    error: string
    timedOutAt: string
    timeoutAt: string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitTargetRunId?: RunId | string
    waitType: string
  }
>
/** Multi-agent parent run: child finished; parent transcript does not surface child output here. */
export type ChildRunCompletedEvent = BaseBackendEvent<
  'child_run.completed',
  RunScopedPayload & {
    childRunId: RunId | string
    parentRunId: RunId | string
    resultKind: string
    rootRunId: RunId | string
    waitId: string
    summary?: unknown
  }
>
/** Run work re-queued after restart or lease recovery — projection uses this; chat UI has no row for it. */
export type RunRequeuedEvent = BaseBackendEvent<
  'run.requeued',
  RunScopedPayload & {
    reason: string
    recoveredFromStatus: string
  }
>
export type MemoryObservationStartedEvent = BaseBackendEvent<
  'memory.observation.started',
  RunScopedPayload & { summaryId: string }
>
export type MemoryObservationCompletedEvent = BaseBackendEvent<
  'memory.observation.completed',
  RunScopedPayload & {
    memoryRecordId: string
    observationCount: number
    source: string
    summaryId: string
    tokenCount: number
  }
>
export type MemoryReflectionStartedEvent = BaseBackendEvent<
  'memory.reflection.started',
  RunScopedPayload & {
    latestReflectionId: string | null
    observationCount: number
  }
>
export type MemoryReflectionCompletedEvent = BaseBackendEvent<
  'memory.reflection.completed',
  RunScopedPayload & {
    generation: number
    latestReflectionId: string | null
    memoryRecordId: string
    observationCount: number
    source: string
    tokenCount: number
  }
>

export type BackendEvent =
  | ChildRunCompletedEvent
  | GenerationCompletedEvent
  | MemoryObservationStartedEvent
  | MemoryObservationCompletedEvent
  | MemoryReflectionStartedEvent
  | MemoryReflectionCompletedEvent
  | MessagePostedEvent
  | ProgressReportedEvent
  | ReasoningSummaryDeltaEvent
  | ReasoningSummaryDoneEvent
  | RunCancelledEvent
  | RunCompletedEvent
  | RunCreatedEvent
  | RunFailedEvent
  | RunRequeuedEvent
  | RunResumedEvent
  | RunStartedEvent
  | RunWaitingEvent
  | StreamDeltaEvent
  | StreamDoneEvent
  | ThreadNamingCompletedEvent
  | ThreadNamingFailedEvent
  | ThreadNamingRequestedEvent
  | ThreadNamingStartedEvent
  | ThreadUpdatedEvent
  | ToolCalledEvent
  | ToolConfirmationGrantedEvent
  | ToolConfirmationRejectedEvent
  | ToolConfirmationRequestedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolWaitingEvent
  | TurnStartedEvent
  | WaitTimedOutEvent
  | WebSearchProgressEvent

export type MessageAttachmentKind = 'image' | 'file'

export interface MessageAttachment {
  id: string
  name: string
  size: number
  mime: string
  kind: MessageAttachmentKind
  url: string
  thumbnailUrl?: string
}

interface BaseBlock<TType extends string> {
  id: string
  sourceRunId?: string
  type: TType
  createdAt: string
}

export interface MarkdownSegment {
  id: string
  source: string
}

export interface TextRenderState {
  committedSegments: MarkdownSegment[]
  liveTail: string
  processedContent: string
  nextSegmentIndex: number
}

export interface TextBlock extends BaseBlock<'text'> {
  content: string
  streaming: boolean
  renderState: TextRenderState
}

export interface ThinkingBlock extends BaseBlock<'thinking'> {
  title: string
  content: string
  status: 'thinking' | 'done'
}

export interface ToolApprovalState {
  description: string | null
  remembered: boolean | null
  status: 'approved' | 'rejected'
  targetRef: string | null
  waitId: string
}

export interface ToolInteractionBlock extends BaseBlock<'tool_interaction'> {
  toolCallId: ToolCallId
  approval?: ToolApprovalState
  appsMeta?: ToolAppsMeta | null
  childRunId?: string
  confirmation?: {
    description: string | null
    ownerRunId?: string
    targetRef: string | null
    waitId: string
  }
  name: string
  args: Record<string, unknown> | null
  sourceRunId?: string
  status: 'running' | 'awaiting_confirmation' | 'complete' | 'error'
  output?: unknown
  finishedAt?: string
}

export interface WebSearchBlock extends BaseBlock<'web_search'> {
  finishedAt?: string
  patterns: string[]
  provider: ProviderName
  queries: string[]
  references: WebSearchReference[]
  responseId: string | null
  searchId: string
  status: WebSearchStatus
  targetUrls: string[]
}

export interface PersistedAssistantToolBlock {
  args: Record<string, unknown> | null
  approval?: ToolApprovalState
  appsMeta?: ToolAppsMeta | null
  childRunId?: string
  confirmation?: {
    description: string | null
    ownerRunId?: string
    targetRef: string | null
    waitId: string
  }
  createdAt: string
  finishedAt?: string
  id: string
  name: string
  output?: unknown
  sourceRunId?: string
  status: ToolInteractionBlock['status']
  toolCallId: ToolCallId | string
  type: 'tool_interaction'
}

export interface PersistedAssistantThinkingBlock {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  status: ThinkingBlock['status']
  title: string
  type: 'thinking'
}

export interface PersistedAssistantTextBlock {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  type: 'text'
}

export interface PersistedAssistantWebSearchBlock {
  createdAt: string
  finishedAt?: string
  id: string
  patterns: string[]
  provider: ProviderName
  queries: string[]
  references: WebSearchReference[]
  responseId: string | null
  searchId: string
  sourceRunId?: string
  status: WebSearchStatus
  targetUrls: string[]
  type: 'web_search'
}

export type PersistedAssistantTranscriptBlock =
  | PersistedAssistantThinkingBlock
  | PersistedAssistantTextBlock
  | PersistedAssistantToolBlock
  | PersistedAssistantWebSearchBlock

export interface PersistedAssistantTranscriptV1 {
  toolBlocks: PersistedAssistantToolBlock[]
  webSearchBlocks?: PersistedAssistantWebSearchBlock[]
  version: 1
}

export interface PersistedAssistantTranscriptV2 {
  blocks: PersistedAssistantTranscriptBlock[]
  toolBlocks: PersistedAssistantToolBlock[]
  webSearchBlocks: PersistedAssistantWebSearchBlock[]
  version: 2
}

export type PersistedAssistantTranscript =
  | PersistedAssistantTranscriptV1
  | PersistedAssistantTranscriptV2

export type ArtifactKind = 'markdown' | 'json' | 'text' | 'file'

export interface ArtifactBlock extends BaseBlock<'artifact'> {
  artifactId: ArtifactId
  kind: ArtifactKind
  title: string
  description?: string
  path?: string
  preview: string
}

export interface ErrorBlock extends BaseBlock<'error'> {
  message: string
}

export type Block =
  | TextBlock
  | ThinkingBlock
  | ToolInteractionBlock
  | WebSearchBlock
  | ArtifactBlock
  | ErrorBlock
