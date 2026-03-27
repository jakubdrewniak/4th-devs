import { resolveModelForProvider } from '../../config.js'
import { join } from 'node:path'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export const PATHS = {
  projectRoot: process.cwd(),
  templateDir: join(process.cwd(), 'templates'),
  awarenessTemplatePath: join(process.cwd(), 'templates', 'awareness.agent.md'),
  scoutTemplatePath: join(process.cwd(), 'templates', 'scout.agent.md'),
  workspaceRoot: join(process.cwd(), 'workspace'),
  profileUserDir: join(process.cwd(), 'workspace', 'profile', 'user'),
  profileAgentDir: join(process.cwd(), 'workspace', 'profile', 'agent'),
  environmentDir: join(process.cwd(), 'workspace', 'environment'),
  memoryEpisodicDir: join(process.cwd(), 'workspace', 'memory', 'episodic'),
  memoryFactualDir: join(process.cwd(), 'workspace', 'memory', 'factual'),
  memoryProceduralDir: join(process.cwd(), 'workspace', 'memory', 'procedural'),
  notesScoutDir: join(process.cwd(), 'workspace', 'notes', 'scout'),
  chatHistoryPath: join(process.cwd(), 'workspace', 'system', 'chat', 'history.jsonl'),
  awarenessStatePath: join(process.cwd(), 'workspace', 'system', 'awareness', 'state.json'),
  workspaceIndexPath: join(process.cwd(), 'workspace', 'system', 'index.md'),
  identityPath: join(process.cwd(), 'workspace', 'profile', 'user', 'identity.md'),
  preferencesPath: join(process.cwd(), 'workspace', 'profile', 'user', 'preferences.md'),
  importantDatesPath: join(process.cwd(), 'workspace', 'profile', 'user', 'important-dates.json'),
} as const

const parseLogFormat = (value: string | undefined): 'pretty' | 'json' =>
  value?.toLowerCase() === 'json' ? 'json' : 'pretty'

const parseLogLevel = (value: string | undefined): 'debug' | 'info' | 'warn' | 'error' => {
  const normalized = value?.toLowerCase()
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized
  }
  return 'warn'
}

export const ENV = {
  openaiModel: resolveModelForProvider(process.env.OPENAI_MODEL ?? 'gpt-5.2'),
  scoutModel: resolveModelForProvider(process.env.SCOUT_MODEL ?? 'gpt-5.2'),
  historyWindow: parsePositiveInt(process.env.AWARENESS_HISTORY_WINDOW, 16),
  maxTurns: parsePositiveInt(process.env.AWARENESS_MAX_TURNS, 10),
  scoutCooldownSeconds: parsePositiveInt(process.env.SCOUT_COOLDOWN_SECONDS, 180),
  weatherTtlMinutes: parsePositiveInt(process.env.WEATHER_TTL_MINUTES, 180),
  logFormat: parseLogFormat(process.env.LOG_FORMAT),
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
} as const
