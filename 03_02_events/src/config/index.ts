import { resolveModelForProvider } from '../../../config.js'
import { join } from 'node:path'

export const PROJECT_ROOT = process.cwd()
export const WORKSPACE_ROOT_DIR = join(PROJECT_ROOT, 'workspace')
export const WORKSPACE_DIR = join(WORKSPACE_ROOT_DIR, 'project')

export const PATHS = {
  PROJECT_ROOT,
  WORKSPACE_ROOT_DIR,
  WORKSPACE_DIR,
  AGENTS_DIR: join(WORKSPACE_ROOT_DIR, 'agents'),
  GOAL_PATH: join(WORKSPACE_ROOT_DIR, 'goal.md'),
  PROJECT_GOAL_PATH: join(WORKSPACE_DIR, 'goal.md'),
  TASKS_DIR: join(WORKSPACE_DIR, 'tasks'),
  EVENTS_DIR: join(WORKSPACE_DIR, 'system', 'events'),
  WAITS_DIR: join(WORKSPACE_DIR, 'system', 'waits'),
  MEMORY_DIR: join(WORKSPACE_DIR, 'system', 'memory'),
  PLAN_DIR: join(WORKSPACE_DIR, 'system', 'plan'),
  PROJECT_PATH: join(WORKSPACE_DIR, 'project.md'),
  NO_GO_PATH: join(WORKSPACE_DIR, 'no-go.md'),
  PLAN_STATE_PATH: join(WORKSPACE_DIR, 'system', 'plan', 'state.json'),
} as const

export const readFlag = (name: string): string | undefined => {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)

  const index = process.argv.findIndex((arg) => arg === name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  return undefined
}

export const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
  return fallback
}

export const ENV = {
  openaiModel: resolveModelForProvider(process.env.OPENAI_MODEL ?? 'gpt-5.2'),
  webSearchModel: resolveModelForProvider(process.env.WEB_SEARCH_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.2'),
  heartbeatDelayMs: parsePositiveInt(process.env.HEARTBEAT_DELAY_MS, 750),
  agentTaskTimeoutMs: parsePositiveInt(process.env.AGENT_TASK_TIMEOUT_MS, 360_000),
} as const
