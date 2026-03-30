import OpenAI from 'openai'
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../config.js'

export { resolveModelForProvider }

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

const parseLogLevel = (value: string | undefined): 'debug' | 'info' | 'warn' | 'error' => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized
  }
  return 'info'
}

export const hasApiKey = (AI_API_KEY as string).trim().length > 0

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
})

export const AGENT_MAX_TURNS = 10

export const ENV = {
  model: resolveModelForProvider(process.env.OPENAI_MODEL ?? 'gpt-5.3-codex') as string,
  reasoningEffort: 'high',
  host: process.env.ARTIFACTS_HOST ?? '127.0.0.1',
  port: parsePositiveInt(process.env.ARTIFACTS_PORT, 4317),
  autoOpenBrowser: parseBool(process.env.ARTIFACTS_AUTO_OPEN, true),
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
} as const
