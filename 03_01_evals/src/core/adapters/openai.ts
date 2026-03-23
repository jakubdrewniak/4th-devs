import OpenAI from 'openai'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from 'openai/error'
import type { Adapter, CompletionError, CompletionResult, ToolCall } from '../../types.js'
import type { Logger } from '../logger.js'
import { err, ok } from '../result.js'

interface OpenAIAdapterConfig {
  apiKey: string
  baseURL?: string
  defaultHeaders?: Record<string, string>
  logger: Logger
  defaultModel?: string
}

const DEFAULT_MODEL = 'gpt-4.1-mini'

const mapError = (error: unknown): CompletionError => {
  if (error instanceof AuthenticationError) {
    return { code: 'AUTHENTICATION_ERROR', message: error.message, provider: 'openai', status: error.status }
  }

  if (error instanceof RateLimitError) {
    return { code: 'RATE_LIMITED', message: error.message, provider: 'openai', status: error.status }
  }

  if (error instanceof BadRequestError) {
    return { code: 'BAD_REQUEST', message: error.message, provider: 'openai', status: error.status }
  }

  if (error instanceof APIConnectionTimeoutError) {
    return { code: 'TIMEOUT', message: error.message, provider: 'openai' }
  }

  if (error instanceof APIConnectionError) {
    return { code: 'CONNECTION_ERROR', message: error.message, provider: 'openai' }
  }

  if (error instanceof InternalServerError) {
    return { code: 'INTERNAL_SERVER_ERROR', message: error.message, provider: 'openai', status: error.status }
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
    provider: 'openai',
  }
}

const extractText = (output: OpenAI.Responses.ResponseOutputItem[]): string => {
  for (const item of output) {
    if (item.type === 'message') {
      for (const block of item.content) {
        if (block.type === 'output_text') return block.text
      }
    }
  }
  return ''
}

const extractToolCalls = (output: OpenAI.Responses.ResponseOutputItem[]): ToolCall[] =>
  output
    .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call')
    .map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments }))

const toResult = (response: OpenAI.Responses.Response): CompletionResult => {
  const usage = response.usage

  return {
    text: extractText(response.output),
    toolCalls: extractToolCalls(response.output),
    output: response.output,
    usage: usage
      ? { input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens }
      : undefined,
  }
}

export const openaiAdapter = (config: OpenAIAdapterConfig): Adapter => {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.defaultHeaders && Object.keys(config.defaultHeaders).length > 0
      ? { defaultHeaders: config.defaultHeaders }
      : {}),
  })
  const model = config.defaultModel ?? DEFAULT_MODEL
  const log = config.logger.child({ module: 'openai-adapter' })

  return {
    complete: async (params) => {
      try {
        const response = await client.responses.create({
          model: params.model ?? model,
          instructions: params.instructions,
          input: params.input,
          tools: params.tools,
          store: false,
        })

        const value = toResult(response)

        log.info('Completion successful', {
          hasText: value.text.length > 0,
          toolCalls: value.toolCalls.length,
        })

        return ok(value)
      } catch (error) {
        const mapped = mapError(error)
        log.error('Completion failed', { code: mapped.code, message: mapped.message })
        return err(mapped)
      }
    },
  }
}
