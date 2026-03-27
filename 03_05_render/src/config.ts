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

const resolveProvider = (): { apiKey: string; baseURL: string; headers: Record<string, string> } => {
  const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? ''
  const requested = process.env.AI_PROVIDER?.trim().toLowerCase() ?? ''

  if (requested === 'openrouter' && openrouterKey) {
    return { apiKey: openrouterKey, baseURL: 'https://openrouter.ai/api/v1', headers: {} }
  }
  if (requested === 'openai' && openaiKey) {
    return { apiKey: openaiKey, baseURL: 'https://api.openai.com/v1', headers: {} }
  }
  if (openaiKey) return { apiKey: openaiKey, baseURL: 'https://api.openai.com/v1', headers: {} }
  if (openrouterKey) return { apiKey: openrouterKey, baseURL: 'https://openrouter.ai/api/v1', headers: {} }
  return { apiKey: '', baseURL: 'https://api.openai.com/v1', headers: {} }
}

const provider = resolveProvider()
const isOpenRouter = provider.baseURL.includes('openrouter')

export const resolveModel = (model: string): string =>
  isOpenRouter && !model.includes('/') ? `openai/${model}` : model

export const ENV = {
  apiKey: provider.apiKey,
  baseURL: provider.baseURL,
  defaultHeaders: provider.headers,
  model: resolveModel(process.env.OPENAI_MODEL ?? 'gpt-5.3-codex'),
  reasoningEffort: 'high',
  host: process.env.RENDER_HOST ?? '127.0.0.1',
  port: parsePositiveInt(process.env.RENDER_PORT, 4321),
  autoOpenBrowser: parseBool(process.env.RENDER_AUTO_OPEN, true),
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
} as const
