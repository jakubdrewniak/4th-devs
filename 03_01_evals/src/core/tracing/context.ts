import { AsyncLocalStorage } from 'node:async_hooks'

export interface PromptRef {
  name: string
  version: number
  isFallback: boolean
}

export interface TracingContext {
  agentName: string
  agentId: string
  turnNumber: number
  toolIndex: number
  promptRef?: PromptRef
}

const storage = new AsyncLocalStorage<TracingContext>()

export const withAgentContext = async <T>(
  agentName: string,
  agentId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const ctx: TracingContext = {
    agentName,
    agentId,
    turnNumber: 0,
    toolIndex: 0,
  }

  return storage.run(ctx, fn)
}

export const advanceTurn = (): number => {
  const ctx = storage.getStore()
  if (!ctx) {
    return 0
  }

  ctx.turnNumber += 1
  ctx.toolIndex = 0
  return ctx.turnNumber
}

const nextToolIndex = (): number => {
  const ctx = storage.getStore()
  if (!ctx) {
    return 1
  }

  ctx.toolIndex += 1
  return ctx.toolIndex
}

export const getCurrentTurn = (): number => storage.getStore()?.turnNumber ?? 0

export const getCurrentAgentName = (): string | undefined => storage.getStore()?.agentName

export const formatGenerationName = (baseName = 'generation'): string => {
  const ctx = storage.getStore()
  if (!ctx) {
    return baseName
  }

  return `${ctx.agentName}/${baseName}#${ctx.turnNumber}`
}

export const formatToolName = (toolName: string): string => {
  const ctx = storage.getStore()
  if (!ctx) {
    return toolName
  }

  return `${ctx.agentName}/${toolName}#${nextToolIndex()}`
}

export const setPromptRef = (ref: PromptRef | undefined): void => {
  const ctx = storage.getStore()
  if (!ctx) {
    return
  }

  ctx.promptRef = ref
}

export const getPromptRef = (): PromptRef | undefined => {
  return storage.getStore()?.promptRef
}
