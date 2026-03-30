import OpenAI from 'openai'
import { resolve } from 'node:path'
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../config.js'
import type { LogLevel } from './types.js'

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

const parseLogLevel = (value: string | undefined): LogLevel => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized
  }
  return 'info'
}

const resolveWorkspacePath = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim() || fallback
  return raw.startsWith('/') ? raw : resolve(process.cwd(), raw)
}

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
})

export const AGENT_MAX_TURNS = 10

export const ENV = {
  model: resolveModelForProvider(process.env.OPENAI_MODEL ?? 'gpt-5.3-codex') as string,
  host: process.env.APPS_HOST ?? '127.0.0.1',
  uiPort: parsePositiveInt(process.env.APPS_UI_PORT, 4321),
  mcpPort: parsePositiveInt(process.env.APPS_MCP_PORT, 4322),
  autoOpenBrowser: parseBool(process.env.APPS_AUTO_OPEN, false),
  todoFilePath: resolveWorkspacePath(process.env.TODO_FILE, 'todo.md'),
  shoppingFilePath: resolveWorkspacePath(process.env.SHOPPING_FILE, 'shopping.md'),
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
} as const
