import { ENV } from './config.js'
import type { LogLevel } from './types.js'

const SCORE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const shouldLog = (level: LogLevel): boolean => SCORE[level] >= SCORE[ENV.logLevel]

const write = (level: LogLevel, event: string, meta?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return
  const payload = {
    at: new Date().toISOString(),
    level,
    event,
    ...(meta ?? {}),
  }
  const line = `${JSON.stringify(payload)}\n`
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line)
    return
  }
  process.stdout.write(line)
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => write('debug', event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write('error', event, meta),
}
