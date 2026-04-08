import OpenAI from 'openai'
import {
  AI_API_KEY,
  AI_PROVIDER,
  CHAT_API_BASE_URL,
  EXTRA_API_HEADERS,
  resolveModelForProvider,
} from './config'

export const DEFAULT_LIVE_MODEL = resolveModelForProvider(
  process.env.LIVE_UI_MODEL?.trim() || 'gpt-4.1',
)

export const openAiClient = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: CHAT_API_BASE_URL,
  defaultHeaders: EXTRA_API_HEADERS,
})

const baseModelName = (model: string): string => model.split('/').pop() ?? model

export const supportsReasoning = (model: string): boolean =>
  /^(o\d|gpt-5)/i.test(baseModelName(model))

export { AI_PROVIDER }
