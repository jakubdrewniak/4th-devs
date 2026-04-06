import { emit } from './events.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgYellow: '\x1b[43m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
} as const

const ACTOR_COLORS: Record<string, string> = {
  orchestrator: c.cyan,
  researcher: c.magenta,
  writer: c.green,
  reviewer: c.yellow,
}

const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false })
const pre = () => `${c.dim}[${ts()}]${c.reset}`
const truncate = (s: string, max = 120) =>
  s.length > max ? `${s.slice(0, max)}…` : s
const badge = (text: string, bg: string) =>
  `${bg}${c.white}${c.bold} ${text} ${c.reset}`

const actorColor = (name: string) => ACTOR_COLORS[name] ?? c.blue
const actorTag = (name: string) =>
  `${actorColor(name)}[${name}]${c.reset}`

export interface ScopedLog {
  llm: (step: number) => void
  decision: (text: string) => void
  tool: (name: string, args: Record<string, unknown>) => void
  toolResult: (name: string, ok: boolean, output: string) => void
  artifact: (action: 'read' | 'wrote', path: string, chars?: number) => void
  usage: (inputTokens: number, outputTokens: number, cachedTokens: number) => void
}

export const log = {
  header: (text: string) => {
    const width = Math.max(text.length + 4, 50)
    console.log(`\n${c.cyan}${'─'.repeat(width)}${c.reset}`)
    console.log(`${c.cyan}│${c.reset} ${c.bold}${text.padEnd(width - 3)}${c.reset}${c.cyan}│${c.reset}`)
    console.log(`${c.cyan}${'─'.repeat(width)}${c.reset}`)
    emit('header', { text })
  },

  info: (msg: string) => {
    console.log(`${pre()} ${msg}`)
    emit('info', { message: msg })
  },

  success: (msg: string) => {
    console.log(`${pre()} ${c.green}✓${c.reset} ${msg}`)
    emit('success', { message: msg })
  },

  error: (msg: string) => {
    console.log(`${pre()} ${c.red}✗${c.reset} ${msg}`)
    emit('error', { message: msg })
  },

  warn: (msg: string) => {
    console.log(`${pre()} ${c.yellow}⚠${c.reset} ${msg}`)
    emit('warn', { message: msg })
  },

  round: (n: number, taskCount: number) => {
    console.log(`\n${pre()} ${badge('ROUND ' + n, c.bgBlue)} ${c.dim}${taskCount} task(s) ready${c.reset}`)
    emit('round', { round: n, taskCount })
  },

  actor: (name: string, taskTitle: string) => {
    console.log(`${pre()} ${actorTag(name)} ${c.dim}working on${c.reset} ${truncate(taskTitle, 60)}`)
    emit('actor', { name, taskTitle })
  },

  delegate: (from: string, to: string, title: string) => {
    console.log(`${pre()} ${actorTag(from)} ${c.magenta}→${c.reset} ${actorTag(to)} ${c.dim}${truncate(title, 50)}${c.reset}`)
    emit('delegate', { from, to, title })
  },

  taskDone: (actorName: string, summary: string) => {
    console.log(`${pre()} ${actorTag(actorName)} ${c.green}✓ completed${c.reset} ${c.dim}${truncate(summary, 70)}${c.reset}`)
    emit('taskDone', { actorName, summary })
  },

  taskWaiting: (actorName: string, reason: string) => {
    console.log(`${pre()} ${actorTag(actorName)} ${c.blue}⏸ waiting${c.reset} ${c.dim}${truncate(reason, 70)}${c.reset}`)
    emit('taskWaiting', { actorName, reason })
  },

  taskBlocked: (actorName: string, reason: string) => {
    console.log(`${pre()} ${actorTag(actorName)} ${c.yellow}◆ blocked${c.reset} ${c.dim}${truncate(reason, 70)}${c.reset}`)
    emit('taskBlocked', { actorName, reason })
  },

  taskError: (actorName: string, error: string) => {
    console.log(`${pre()} ${actorTag(actorName)} ${c.red}✗ error${c.reset} ${c.dim}${truncate(error, 70)}${c.reset}`)
    emit('taskError', { actorName, error })
  },

  artifact: (action: 'read' | 'wrote', path: string, chars?: number) => {
    const detail = chars !== undefined ? ` ${c.dim}(${chars.toLocaleString()} chars)${c.reset}` : ''
    console.log(`${pre()} ${c.cyan}📄${c.reset} ${action} ${c.bold}${path}${c.reset}${detail}`)
    emit('artifact', { action, path, chars })
  },

  memoryStatus: (itemCount: number, pendingTokens: number, observationTokens: number, generation: number) => {
    console.log(`${pre()} ${c.magenta}🧠${c.reset} ${c.dim}pending: ${pendingTokens} tokens (${itemCount} items) | observations: ${observationTokens} tokens (gen ${generation})${c.reset}`)
    emit('memory.status', { itemCount, pendingTokens, observationTokens, generation })
  },

  memoryObserved: (itemCount: number, observationLines: number, tokens: number, sealedSeq: number) => {
    console.log(`${pre()} ${c.magenta}🧠 observed${c.reset} ${itemCount} items → ${observationLines} lines (${tokens} tokens, sealed through #${sealedSeq})`)
    emit('memory.observed', { itemCount, observationLines, tokens, sealedSeq })
  },

  memoryReflected: (tokensBefore: number, tokensAfter: number, level: number, generation: number) => {
    console.log(`${pre()} ${c.magenta}🧠 reflected${c.reset} ${tokensBefore} → ${tokensAfter} tokens (level ${level}, gen ${generation})`)
    emit('memory.reflected', { tokensBefore, tokensAfter, level, generation })
  },

  memorySkipped: (pendingTokens: number, threshold: number) => {
    console.log(`${pre()} ${c.magenta}🧠${c.reset} ${c.dim}below threshold (${pendingTokens} < ${threshold}), skipped${c.reset}`)
    emit('memory.skipped', { pendingTokens, threshold })
  },

  memoryPersisted: (filename: string) => {
    console.log(`${pre()} ${c.magenta}🧠${c.reset} ${c.dim}persisted ${filename}${c.reset}`)
    emit('memory.persisted', { filename })
  },

  summary: (label: string, value: string | number) => {
    console.log(`  ${c.dim}${label}:${c.reset} ${c.bold}${value}${c.reset}`)
    emit('summary', { label, value })
  },

  done: () => {
    emit('done', {})
  },

  scoped: (actorName: string): ScopedLog => {
    const tag = actorTag(actorName)

    return {
      llm: (step: number) => {
        console.log(`${pre()} ${tag} ${c.dim}LLM step ${step}${c.reset}`)
        emit('llm', { step, actorName })
      },

      decision: (text: string) => {
        console.log(`${pre()} ${tag} ${c.blue}💭${c.reset} ${c.dim}${truncate(text, 90)}${c.reset}`)
        emit('decision', { text, actorName })
      },

      tool: (name: string, args: Record<string, unknown>) => {
        const argStr = JSON.stringify(args)
        console.log(`${pre()} ${tag} ${c.yellow}⚡${c.reset} ${c.bold}${name}${c.reset} ${c.dim}${truncate(argStr, 70)}${c.reset}`)
        emit('tool', { name, args, actorName })
      },

      toolResult: (name: string, ok: boolean, output: string) => {
        const icon = ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
        console.log(`${pre()} ${tag}   ${icon} ${c.dim}${truncate(output, 90)}${c.reset}`)
        emit('toolResult', { name, ok, output: truncate(output, 200), actorName })
      },

      artifact: (action: 'read' | 'wrote', path: string, chars?: number) => {
        const detail = chars !== undefined ? ` ${c.dim}(${chars.toLocaleString()} chars)${c.reset}` : ''
        console.log(`${pre()} ${tag} ${c.cyan}📄${c.reset} ${action} ${c.bold}${path}${c.reset}${detail}`)
        emit('artifact', { action, path, chars, actorName })
      },

      usage: (inputTokens: number, outputTokens: number, cachedTokens: number) => {
        const cacheRate = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0
        const cacheInfo = cachedTokens > 0
          ? ` ${c.green}(${cachedTokens} cached, ${cacheRate}% hit)${c.reset}`
          : ''
        console.log(`${pre()} ${tag} ${c.dim}tokens: ${inputTokens} in / ${outputTokens} out${cacheInfo}${c.reset}`)
        emit('usage', { actorName, inputTokens, outputTokens, cachedTokens, cacheRate })
      },
    }
  },
}
