import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LOG_DIR } from './config.js'

export interface Logger {
  info(scope: string, message: string): void
  error(scope: string, error: unknown, message?: string): void
}

export interface SessionLogger extends Logger {
  event(type: string, data?: Record<string, unknown>): Promise<void>
  path: string
}

const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const printScope = (scope: string): string => `${DIM}[${scope}]${RESET}`

export const consoleLogger: Logger = {
  info: (scope, message) => {
    console.log(`  ${printScope(scope)} ${message}`)
  },
  error: (scope, error, message = 'Unexpected error') => {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`  ${RED}[${scope}] ${message}: ${detail}${RESET}`)
  },
}

export const createSessionLogger = (sessionId: string): SessionLogger => {
  const path = join(LOG_DIR, `${sessionId}.jsonl`)

  const event: SessionLogger['event'] = async (type, data = {}) => {
    try {
      await mkdir(LOG_DIR, { recursive: true })
      await appendFile(path, `${JSON.stringify({
        at: new Date().toISOString(),
        type,
        sessionId,
        ...data,
      })}\n`)
    } catch {
      // Logging should never break the agent.
    }
  }

  return {
    ...consoleLogger,
    event,
    path,
  }
}
