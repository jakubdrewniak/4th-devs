type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_SCORE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const parseLogLevel = (value: string | undefined): LogLevel => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value
  }
  return 'info'
}

const MIN_LEVEL = parseLogLevel(process.env.LOG_LEVEL?.toLowerCase())

const shouldLog = (level: LogLevel): boolean => LEVEL_SCORE[level] >= LEVEL_SCORE[MIN_LEVEL]

const write = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return

  const payload = {
    at: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  }

  const line = `${JSON.stringify(payload)}\n`
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line)
    return
  }

  process.stdout.write(line)
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
}
