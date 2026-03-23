export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
  child: (bindings: Record<string, unknown>) => Logger
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const write = (
  level: LogLevel,
  bindings: Record<string, unknown>,
  message: string,
  data?: Record<string, unknown>,
): void => {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...bindings,
    ...(data ?? {}),
  }

  const line = JSON.stringify(payload)

  if (level === 'error') {
    console.error(line)
    return
  }

  if (level === 'warn') {
    console.warn(line)
    return
  }

  console.log(line)
}

export const createLogger = (bindings: Record<string, unknown> = {}): Logger => {
  return {
    debug: (message, data) => write('debug', bindings, message, data),
    info: (message, data) => write('info', bindings, message, data),
    warn: (message, data) => write('warn', bindings, message, data),
    error: (message, data) => write('error', bindings, message, data),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  }
}
