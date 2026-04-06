import type OpenAI from 'openai'
import type { Response, ToolCall, TokenUsage } from './types.js'

export const extractText = (response: Response): string =>
  response.output
    .filter(
      (item): item is OpenAI.Responses.ResponseOutputMessage => item.type === 'message',
    )
    .flatMap(message => message.content)
    .filter(
      (part): part is OpenAI.Responses.ResponseOutputText => part.type === 'output_text',
    )
    .map(part => part.text)
    .join('')

const safeParseObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    console.error(`[ai] failed to parse tool arguments: ${value.slice(0, 200)}`)
    return {}
  }
}

export const extractToolCalls = (response: Response): ToolCall[] =>
  response.output
    .filter(item => item.type === 'function_call')
    .map(item => ({
      callId: item.call_id,
      name: item.name,
      arguments: safeParseObject(item.arguments),
    }))

export const extractUsage = (response: Response): TokenUsage | undefined => {
  const u = response.usage
  if (!u) return undefined
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    totalTokens: u.total_tokens,
    cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
  }
}
