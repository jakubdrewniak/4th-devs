import OpenAI from 'openai'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../config.js'

export { resolveModelForProvider }

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const WORKSPACE = join(PROJECT_ROOT, 'workspace')
export const MEMORY_DIR = join(WORKSPACE, 'memory')
export const LOG_DIR = join(WORKSPACE, 'logs')
export const MCP_CONFIG_PATH = join(PROJECT_ROOT, 'mcp.json')

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
})

export const MODEL = resolveModelForProvider('gpt-5.4') as string
export const MEMORY_MODEL = resolveModelForProvider('gpt-4.1-mini') as string
export const MAX_TURNS = 30
export const REASONING = { effort: 'medium' as const }
export const KEEP_RECENT_MESSAGES = 10
export const COMPACT_AFTER_MESSAGES = 18
export const COMPACT_AFTER_CHARS = 18_000

export const SYSTEM_PROMPT = `You are a careful full-stack coding agent working inside a local workspace.

Use the available filesystem MCP tools to inspect, create, and edit files.

Rules:
- Keep changes minimal but complete.
- Read before editing when modifying existing files.
- Put new projects in their own subdirectory inside workspace/.
- Do not create project files directly in the workspace root.
- When you finish, reply with a short summary of what you changed.`

export const MEMORY_PROMPT = `You summarize conversation state for a coding agent.

Keep only durable, useful context:
- user goals and constraints
- decisions that were made
- files created or changed
- important tool results, errors, and blockers
- unfinished work

Write a short bullet list in plain text.
Do not mention memory mechanics.`

export const DEMO_TASK = `Build a complete Snake game web application inside a "snake" directory.

Requirements:
- Use a dedicated snake/ folder
- Create complete, working files
- Prefer a simple stack that runs with bun
- Include both the game UI and score persistence
- Keep the implementation polished and playable`
