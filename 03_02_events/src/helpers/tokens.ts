import type { Message } from '../types.js'

const CHARS_PER_TOKEN = 4
const SAFETY_MARGIN = 1.2
const IMAGE_TOKEN_ESTIMATE = 1_200

let cumulativeEstimated = 0
let cumulativeActual = 0

/**
 * Raw chars/4 estimate — stable, no calibration applied.
 * Use this for threshold comparisons.
 */
export const estimateTokensRaw = (text: string): number => {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Calibrated estimate — adapts based on API-reported usage.
 * Use this for logging and budgets.
 */
export const estimateTokens = (text: string): number => {
  const base = estimateTokensRaw(text)
  if (!base) return 0

  if (cumulativeActual > 500 && cumulativeEstimated > 0) {
    const ratio = cumulativeActual / cumulativeEstimated
    return Math.ceil(base * ratio)
  }

  return base
}

export const withSafetyMargin = (tokens: number): number =>
  Math.ceil(tokens * SAFETY_MARGIN)

export const estimateMessageTokens = (message: Message): number => {
  let tokens = 4

  const content = 'content' in message ? message.content : undefined
  if (typeof content === 'string') {
    tokens += estimateTokens(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      if ('text' in part && typeof part.text === 'string') {
        tokens += estimateTokens(part.text)
      } else if ('type' in part && part.type === 'image_url') {
        tokens += IMAGE_TOKEN_ESTIMATE
      }
    }
  }

  if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (!('function' in toolCall)) continue
      tokens += estimateTokens(toolCall.function.name)
      tokens += estimateTokens(toolCall.function.arguments)
      tokens += 10
    }
  }

  return tokens
}

export const estimateMessagesTokens = (
  messages: Message[],
): { raw: number; safe: number } => {
  const raw = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  return { raw, safe: withSafetyMargin(raw) }
}

export const estimateMessagesTokensRaw = (messages: Message[]): number => {
  let total = 0

  for (const message of messages) {
    total += 4
    const content = 'content' in message ? message.content : undefined

    if (typeof content === 'string') {
      total += estimateTokensRaw(content)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          total += estimateTokensRaw(part.text)
        }
      }
    }

    if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!('function' in toolCall)) continue
        total += estimateTokensRaw(toolCall.function.name)
        total += estimateTokensRaw(toolCall.function.arguments)
        total += 10
      }
    }
  }

  return total
}

export const recordActualUsage = (estimated: number, actual: number): void => {
  cumulativeEstimated += estimated
  cumulativeActual += actual
}

export const getCalibration = (): { ratio: number | null; samples: number } => {
  if (cumulativeActual < 100 || cumulativeEstimated === 0) {
    return { ratio: null, samples: cumulativeActual }
  }

  return { ratio: cumulativeActual / cumulativeEstimated, samples: cumulativeActual }
}
