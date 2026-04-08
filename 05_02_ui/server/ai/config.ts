import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AI_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(AI_DIR, '..')
const PROJECT_DIR = path.resolve(SERVER_DIR, '..')
const WORKSPACE_DIR = path.resolve(PROJECT_DIR, '..')
const ROOT_ENV_FILE = path.join(WORKSPACE_DIR, '.env')

const CHAT_API_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
} as const

const stripMatchingQuotes = (value: string): string => {
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
  ) {
    return value.slice(1, -1)
  }

  return value
}

const loadEnvFile = (file: string): void => {
  if (!existsSync(file)) {
    return
  }

  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file)
    return
  }

  const raw = readFileSync(file, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length)
      : trimmed
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    if (!key || process.env[key] !== undefined) {
      continue
    }

    process.env[key] = stripMatchingQuotes(normalized.slice(separatorIndex + 1).trim())
  }
}

loadEnvFile(ROOT_ENV_FILE)

const requestedProvider = process.env.AI_PROVIDER?.trim().toLowerCase()
const openAiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? ''

export const AI_PROVIDER = requestedProvider === 'openrouter' && openRouterKey
  ? 'openrouter'
  : openAiKey
    ? 'openai'
    : openRouterKey
      ? 'openrouter'
      : 'openai'

export const AI_API_KEY = AI_PROVIDER === 'openai' ? openAiKey : openRouterKey

export const CHAT_API_BASE_URL = CHAT_API_BASE_URLS[AI_PROVIDER]

export const EXTRA_API_HEADERS: Record<string, string> = AI_PROVIDER === 'openrouter'
  ? {
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      ...(process.env.OPENROUTER_APP_NAME
        ? { 'X-Title': process.env.OPENROUTER_APP_NAME }
        : {}),
    }
  : {}

export const resolveModelForProvider = (model: string): string =>
  AI_PROVIDER === 'openrouter' && !model.includes('/')
    ? `openai/${model}`
    : model
