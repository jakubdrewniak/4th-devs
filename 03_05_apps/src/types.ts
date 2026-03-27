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

export type AgentTurnResult =
  | {
      kind: 'chat'
      text: string
    }
  | {
      kind: 'open_manager'
      text: string
      focus: ManagerFocus
    }
