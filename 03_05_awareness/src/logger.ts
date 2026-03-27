import { ENV } from './config.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const SCORE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const shouldLog = (level: LogLevel): boolean => SCORE[level] >= SCORE[ENV.logLevel]

const color = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
} as const

const pad = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length)

const writeJson = (level: LogLevel, event: string, meta?: Record<string, unknown>): void => {
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

const formatMeta = (meta?: Record<string, unknown>): string => {
  if (!meta) return ''
  const entries = Object.entries(meta)
  if (entries.length === 0) return ''
  const rendered = entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
  return rendered ? ` ${color.dim}${rendered}${color.reset}` : ''
}

const writePretty = (level: LogLevel, event: string, meta?: Record<string, unknown>): void => {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const time = `${hh}:${mm}:${ss}`

  const isDim = level === 'debug' || level === 'info'

  const levelColor =
    level === 'error' ? color.red
      : level === 'warn' ? color.yellow
        : color.dim

  const line = isDim
    ? `${color.dim}${time} ${pad(level.toUpperCase(), 5)} ${event}${formatMeta(meta)}${color.reset}\n`
    : `${color.dim}${time}${color.reset} ${levelColor}${pad(level.toUpperCase(), 5)}${color.reset} ${event}${formatMeta(meta)}\n`

  if (level === 'warn' || level === 'error') {
    process.stderr.write(line)
    return
  }
  process.stdout.write(line)
}

const write = (level: LogLevel, event: string, meta?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return
  if (ENV.logFormat === 'json') {
    writeJson(level, event, meta)
    return
  }
  writePretty(level, event, meta)
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => write('debug', event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write('error', event, meta),
}

const line = (char = '─', len = 76): string => char.repeat(len)

export const ui = {
  banner: (model: string, historyInjected: number): void => {
    if (ENV.logFormat === 'json') return
    const bold = (t: string) => `\x1b[1m${t}${color.reset}`
    const hr = `${color.dim}${'─'.repeat(52)}${color.reset}`

    console.log()
    console.log(hr)
    console.log(bold('  Awareness Agent — Contextual Memory'))
    console.log(hr)
    console.log()
    console.log(`  ${color.dim}Model${color.reset}             ${color.cyan}${model}${color.reset}`)
    console.log(`  ${color.dim}History loaded${color.reset}    ${color.cyan}${historyInjected} conversation(s)${color.reset}`)
    console.log()
    console.log(`${color.dim}  What you can do:${color.reset}`)
    console.log(`  ${color.dim}•${color.reset} Chat naturally — the agent ${bold('remembers')} past conversations`)
    console.log(`  ${color.dim}•${color.reset} It uses ${bold('recall')} to pull relevant context from memory`)
    console.log(`  ${color.dim}•${color.reset} Each conversation is ${bold('saved')} automatically for future use`)
    console.log(`  ${color.dim}•${color.reset} Type ${bold('exit')} or ${bold('quit')} to stop`)
    console.log()
    console.log(hr)
    console.log()
  },
  user: (message: string): void => {
    if (ENV.logFormat === 'json') return
    console.log(`${color.yellow}you${color.reset} ${message}`)
  },
  assistant: (message: string): void => {
    if (ENV.logFormat === 'json') return
    console.log(`${color.green}agent${color.reset} ${message}`)
  },
  tool: (name: string, detail?: string): void => {
    if (ENV.logFormat === 'json') return
    const suffix = detail ? ` ${detail}` : ''
    console.log(`${color.dim}tool ${name}${suffix}${color.reset}`)
  },
  toolDetail: (detail: string): void => {
    if (ENV.logFormat === 'json') return
    console.log(`${color.dim}  ${detail}${color.reset}`)
  },
}
