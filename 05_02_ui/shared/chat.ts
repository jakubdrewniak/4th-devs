export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'complete' | 'streaming' | 'error'
export type StreamMode = 'mock' | 'live'

export interface ConversationSnapshot {
  id: string
  title: string
  mode: StreamMode
  historyCount: number
  messages: ConversationMessage[]
}

export interface ConversationMessage {
  id: string
  role: MessageRole
  status: MessageStatus
  createdAt: string
  text?: string
  events: StreamEvent[]
}

interface BaseStreamEvent<TType extends string> {
  id: string
  type: TType
  messageId: string
  seq: number
  at: string
}

export interface AssistantMessageStartEvent extends BaseStreamEvent<'assistant_message_start'> {
  title?: string
}

export interface TextDeltaEvent extends BaseStreamEvent<'text_delta'> {
  textDelta: string
}

export interface ThinkingStartEvent extends BaseStreamEvent<'thinking_start'> {
  label?: string
}

export interface ThinkingDeltaEvent extends BaseStreamEvent<'thinking_delta'> {
  textDelta: string
}

export interface ThinkingEndEvent extends BaseStreamEvent<'thinking_end'> {}

export interface ToolCallEvent extends BaseStreamEvent<'tool_call'> {
  toolCallId: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResultEvent extends BaseStreamEvent<'tool_result'> {
  toolCallId: string
  ok: boolean
  output: unknown
}

export type ArtifactKind = 'markdown' | 'json' | 'text' | 'file'

export interface ArtifactEvent extends BaseStreamEvent<'artifact'> {
  artifactId: string
  kind: ArtifactKind
  title: string
  description?: string
  path?: string
  preview: string
}

export interface ErrorEvent extends BaseStreamEvent<'error'> {
  message: string
}

export interface CompleteEvent extends BaseStreamEvent<'complete'> {
  finishReason: 'stop' | 'error' | 'cancelled'
}

export type StreamEvent =
  | AssistantMessageStartEvent
  | TextDeltaEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | ArtifactEvent
  | ErrorEvent
  | CompleteEvent

interface BaseBlock<TType extends string> {
  id: string
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

export interface ToolInteractionBlock extends BaseBlock<'tool_interaction'> {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'complete' | 'error'
  output?: unknown
  finishedAt?: string
}

export interface ArtifactBlock extends BaseBlock<'artifact'> {
  artifactId: string
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
  | ArtifactBlock
  | ErrorBlock
