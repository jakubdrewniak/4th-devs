import type OpenAI from 'openai'

export type ResponseInputItem = OpenAI.Responses.ResponseInputItem
export type ResponseInput = ResponseInputItem[]
export type Response = OpenAI.Responses.Response

export interface FunctionToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
}

export interface GenerateTextInput {
  instructions: string
  input: string | ResponseInput
  maxOutputTokens?: number
}

export interface GenerateTextResult {
  text: string
  usage?: TokenUsage
  response: Response
}

export interface GenerateToolStepInput {
  instructions: string
  input: ResponseInput
  tools: FunctionToolDefinition[]
  webSearch?: boolean
  promptCacheKey?: string
  maxOutputTokens?: number
}

export interface GenerateToolStepResult {
  text: string
  toolCalls: ToolCall[]
  usage?: TokenUsage
  response: Response
}
