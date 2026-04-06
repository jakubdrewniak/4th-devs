import OpenAI from 'openai'
import { primitivesConfig } from '../../config.js'
import type {
  GenerateTextInput, GenerateTextResult,
  GenerateToolStepInput, GenerateToolStepResult,
} from './types.js'
import { extractText, extractToolCalls, extractUsage } from './parsers.js'

const client = new OpenAI({
  apiKey: primitivesConfig.apiKey,
  baseURL: primitivesConfig.baseUrl,
  defaultHeaders: primitivesConfig.headers,
})

export const describeLlm = (): string =>
  `${primitivesConfig.provider}:${primitivesConfig.model}`

// ── Retry ───────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 2
const BASE_DELAY_MS = 1_000

const isRetryable = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  const status = (err as Error & { status?: number }).status
  if (typeof status === 'number') return RETRYABLE_CODES.has(status)
  return /ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(err.message)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err
      const delay = BASE_DELAY_MS * 2 ** attempt
      console.warn(`[ai] retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
      await sleep(delay)
    }
  }
  throw lastErr
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateText({
  instructions,
  input,
  maxOutputTokens,
}: GenerateTextInput): Promise<GenerateTextResult> {
  const response = await withRetry(() =>
    client.responses.create({
      model: primitivesConfig.model,
      instructions,
      input,
      ...(primitivesConfig.supportsReasoning && { reasoning: primitivesConfig.reasoning }),
      max_output_tokens: maxOutputTokens ?? primitivesConfig.maxOutputTokens,
    }),
  )

  return {
    text: extractText(response),
    usage: extractUsage(response),
    response,
  }
}

export async function generateToolStep({
  instructions,
  input,
  tools,
  webSearch,
  promptCacheKey,
  maxOutputTokens,
}: GenerateToolStepInput): Promise<GenerateToolStepResult> {
  const apiTools: Array<Record<string, unknown>> = tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }))

  const isOpenRouter = primitivesConfig.provider === 'openrouter'

  if (webSearch && !isOpenRouter) {
    apiTools.push({ type: 'web_search_preview' })
  }

  const effectiveModel = webSearch && isOpenRouter
    ? `${primitivesConfig.model}:online`
    : primitivesConfig.model

  const response = await withRetry(() =>
    client.responses.create({
      model: effectiveModel,
      instructions,
      input,
      ...(primitivesConfig.supportsReasoning && { reasoning: primitivesConfig.reasoning }),
      prompt_cache_key: promptCacheKey,
      max_output_tokens: maxOutputTokens ?? primitivesConfig.maxOutputTokens,
      parallel_tool_calls: true,
      tools: apiTools as unknown as Parameters<typeof client.responses.create>[0]['tools'],
    }),
  )

  return {
    text: extractText(response),
    toolCalls: extractToolCalls(response),
    usage: extractUsage(response),
    response,
  }
}
