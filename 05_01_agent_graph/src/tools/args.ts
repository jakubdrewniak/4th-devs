import type { ActorToolName } from './types.js'
import { isActorToolName } from './types.js'

export const getString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} must be a non-empty string`)
  return value.trim()
}

export const getOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const getPositiveInteger = (value: unknown, fallback: number): number =>
  Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback

export const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

export const getToolNameArray = (value: unknown, fieldName: string): ActorToolName[] => {
  const tools = getStringArray(value).filter(isActorToolName)
  if (tools.length === 0) throw new Error(`${fieldName} must include at least one valid tool`)
  return Array.from(new Set(tools))
}
