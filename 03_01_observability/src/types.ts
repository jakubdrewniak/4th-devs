import type OpenAI from 'openai'
import type { Result } from './core/result.js'
import type { Logger } from './core/logger.js'

export type Message = OpenAI.ChatCompletionMessageParam

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface Usage {
  input?: number
  output?: number
  total?: number
}

export interface CompletionParams {
  input: Message[]
  instructions?: string
  model?: string
  tools?: OpenAI.ChatCompletionTool[]
  toolChoice?: OpenAI.ChatCompletionToolChoiceOption
}

export interface CompletionResult {
  text: string
  toolCalls: ToolCall[]
  usage?: Usage
}

export type CompletionErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_SERVER_ERROR'
  | 'UNKNOWN_ERROR'

export interface CompletionError {
  code: CompletionErrorCode
  message: string
  provider?: Provider
  status?: number
}

export interface Adapter {
  complete: (params: CompletionParams) => Promise<Result<CompletionResult, CompletionError>>
}

export type Provider = 'openai'

export type AdapterResolver = (provider: Provider) => Result<Adapter, CompletionError>

export interface Session {
  id: string
  messages: Message[]
}

export interface AgentRunResult {
  response: string
  turns: number
  usage: Usage
}

export interface RunAgentParams {
  adapter: Adapter
  logger: Logger
  session: Session
  message: string
}

export interface AppDeps {
  logger: Logger
  adapterResolver: AdapterResolver
}
