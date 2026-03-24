import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../../config.js'
import OpenAI from 'openai'

let cachedOpenAI: OpenAI | null = null

export const getOpenAI = (): OpenAI => {
  if (cachedOpenAI) return cachedOpenAI

  cachedOpenAI = new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS })
  return cachedOpenAI
}
