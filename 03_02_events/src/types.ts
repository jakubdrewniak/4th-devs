import type OpenAI from 'openai'

export type Message = OpenAI.ChatCompletionMessageParam
export type AgentName = string

export interface AgentTemplate {
  name: AgentName
  model: string
  tools: string[]
  capabilities: string[]
  systemPrompt: string
}

export interface MemoryState {
  activeObservations: string
  lastObservedIndex: number
  observationTokenCount: number
  generationCount: number
  _observerRanThisRequest?: boolean
}

export interface Session {
  id: string
  messages: Message[]
  memory: MemoryState
}

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ToolResult =
  | { kind: 'text'; content: string }
  | { kind: 'human_request'; waitId: string; question: string }

export interface ToolRuntimeContext {
  agent: AgentName
  workspacePath: string
  openai: OpenAI
  abortSignal?: AbortSignal
}

export interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>, ctx: ToolRuntimeContext) => Promise<ToolResult>
}

export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'waiting-human' | 'done'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

export interface TaskFrontmatter {
  id: string
  title: string
  project: string
  owner: AgentName
  goal_id?: string
  plan_version?: number
  required_capabilities?: string[]
  status: TaskStatus
  priority: TaskPriority
  depends_on: string[]
  output_path?: string
  created_by: AgentName | 'system' | 'human'
  attempt: number
  max_attempts: number
  next_attempt_at?: string
  claimed_by?: AgentName
  claimed_at?: string
  run_id?: string
  blocked_reason?: string
  blocked_by?: string[]
  wait_id?: string
  wait_question?: string
  human_answer?: string
  completion_note?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface TaskRecord {
  path: string
  slug: string
  frontmatter: TaskFrontmatter
  body: string
}

export type HeartbeatEventType =
  | 'plan.generated'
  | 'plan.validation-failed'
  | 'plan.no-go'
  | 'plan.approved'
  | 'replan.applied'
  | 'replan.validation-failed'
  | 'replan.skipped'
  | 'heartbeat.started'
  | 'heartbeat.finished'
  | 'heartbeat.idle'
  | 'task.claimed'
  | 'task.completed'
  | 'task.blocked'
  | 'task.unblocked'
  | 'task.waiting-human'
  | 'tool.call'
  | 'human.input-provided'
  | 'memory.observed'
  | 'memory.reflected'
  | 'project.completed'

export interface HeartbeatEvent {
  type: HeartbeatEventType
  round: number
  at: string
  message: string
  agent?: AgentName
  taskId?: string
  data?: Record<string, unknown>
}

export interface AgentUsage {
  totalEstimatedTokens: number
  totalActualTokens: number
  turns: number
  calibrationRatio: number | null
}

export type AgentRunStatus = 'done' | 'waiting-human' | 'failed'

export interface AgentRunResult {
  status: AgentRunStatus
  response: string
  waitId?: string
  waitQuestion?: string
  error?: string
  usage: AgentUsage
}
