export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ListKind = 'todo' | 'shopping'

export interface ListItem {
  id: string
  text: string
  done: boolean
}

export interface ListsState {
  todo: ListItem[]
  shopping: ListItem[]
  updatedAt: string
}

export type ManagerFocus = ListKind

export type TextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type FunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type Message = TextMessage | FunctionCallItem | FunctionCallOutputItem

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: boolean
}

export interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>) => Promise<string>
}

export interface AgentContext {
  todoFilePath: string
  shoppingFilePath: string
  uiUrl: string
}

export interface AgentResult {
  text: string
  turns: number
}
