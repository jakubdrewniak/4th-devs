import type { Task } from '../domain.js'

export const MAX_LLM_CALL_ATTEMPTS = 3
export const MAX_AUTO_RETRY_ATTEMPTS = 3

const BASE_RETRY_DELAY_MS = 1_500
const MAX_RETRY_DELAY_MS = 15_000

const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
])

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

export const computeRetryDelayMs = (attempt: number): number =>
  Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)))

export const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class RecoverableActorError extends Error {
  readonly retryAfterMs: number

  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'RecoverableActorError'
    this.retryAfterMs = retryAfterMs
  }
}

export const isTransientLlmError = (error: unknown): boolean => {
  const record = asRecord(error)
  const status = typeof record?.status === 'number' ? record.status : undefined
  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) return true

  const code = typeof record?.code === 'string' ? record.code : undefined
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true

  const message = formatError(error).toLowerCase()
  return (
    message.includes('timeout')
    || message.includes('temporarily unavailable')
    || message.includes('connection reset')
    || message.includes('network')
    || message.includes('rate limit')
    || message.includes('overloaded')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
  )
}

export const shouldAutoRetryTask = (
  task: Task,
  referenceTimeMs = Date.now(),
): boolean => {
  if (task.status !== 'blocked') return false

  const recovery = task.recovery
  if (!recovery?.autoRetry) return false
  if (recovery.attempts > MAX_AUTO_RETRY_ATTEMPTS) return false

  if (!recovery.nextRetryAt) return true

  const nextRetryMs = Date.parse(recovery.nextRetryAt)
  return Number.isNaN(nextRetryMs) || nextRetryMs <= referenceTimeMs
}
