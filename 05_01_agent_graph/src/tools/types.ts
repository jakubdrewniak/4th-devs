import type { ToolCall } from '../ai/index.js'
import type { Actor, Task } from '../domain.js'
import type { Runtime } from '../runtime.js'

export const ACTOR_TOOL_NAMES = [
  'create_actor',
  'delegate_task',
  'read_artifact',
  'write_artifact',
  'send_email',
  'complete_task',
  'block_task',
] as const

export type ActorToolName = (typeof ACTOR_TOOL_NAMES)[number]

export const isActorToolName = (value: unknown): value is ActorToolName =>
  typeof value === 'string' && ACTOR_TOOL_NAMES.includes(value as ActorToolName)

export interface ActorToolConfig {
  instructions: string
  tools: ActorToolName[]
  webSearch: boolean
}

export interface ToolExecutionOutcome {
  status: 'continue' | 'completed' | 'blocked'
  output: string
  message: string
}

export interface ToolContext {
  call: ToolCall
  task: Task
  actor: Actor
  rt: Runtime
}

export type ToolHandler = (ctx: ToolContext) => Promise<ToolExecutionOutcome>
