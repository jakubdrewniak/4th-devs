const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const SESSION = `demo-${Date.now()}`

const blue = (s: string) => `\x1b[34m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const messages = [
  // Phase 1: Building identity
  'Hi! My name is Adam. I\'m a developer from Poland.',
  'I run a company called easy_ and we build AI-powered automation tools.',
  'My favorite programming language is TypeScript but I also enjoy Rust for performance-critical stuff.',

  // Phase 2: Active work context → should trigger first observation
  'I\'m currently working on a presentation about agentic context engineering. The deadline is next Friday.',
  'The key topics I want to cover are: observer pattern, reflector pattern, and token estimation heuristics.',

  // Phase 3: Personal preferences + tool use
  'Can you write a file notes/adam-profile.md with a summary of what you know about me?',
  'I prefer dark mode in all my apps and I drink flat white coffee. My dog\'s name is Alexa.',

  // Phase 4: More context to push observations past reflection threshold
  'For the presentation, I\'m using a project called 01_05_agent as the reference implementation.',
  'The audience will be experienced developers who already know TypeScript and Node.js.',
  'I also want to demonstrate how token estimation uses chars/4 heuristic with API calibration.',

  // Phase 5: State changes + memory recall
  'Actually, I changed my mind about Rust. I\'m more into Go these days for backend work.',
  'Quick check — what do you remember about my presentation? What topics am I covering?',

  // Phase 6: Final comprehensive memory test
  'Summarize everything you know about me in a few bullet points.',
]

interface ChatResponse {
  response?: string
  memory?: {
    hasObservations?: boolean
    observationTokens?: number
    generation?: number
    totalMessages?: number
    sealedMessages?: number
    activeMessages?: number
  }
  usage?: { totalEstimatedTokens?: number; totalActualTokens?: number; calibration?: { ratio: number | null }; turns?: number }
}

async function send(label: string, message: string) {
  console.log()
  console.log(blue(`━━━ Message ${label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`))
  console.log(yellow(`→ ${message}`))
  console.log()

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, message }),
  })

  const data: ChatResponse = await res.json()

  console.log(green(`← ${data.response ?? 'no response'}`))
  console.log()

  const gen = data.memory?.generation ?? 0
  const genLabel = gen > 0 ? cyan(` ★ gen ${gen} (reflector ran)`) : ''

  const sealed = data.memory?.sealedMessages ?? 0
  const active = data.memory?.activeMessages ?? 0
  const sealLabel = sealed > 0 ? yellow(` [${sealed} sealed, ${active} active]`) : ''

  console.log(dim(`   memory: observations=${data.memory?.hasObservations ?? false} tokens=${data.memory?.observationTokens ?? 0} generation=${gen}`) + genLabel + sealLabel)
  console.log(dim(`   usage:  estimated=${data.usage?.totalEstimatedTokens ?? '?'} actual=${data.usage?.totalActualTokens ?? '?'} calibration=${data.usage?.calibration?.ratio?.toFixed(2) ?? 'n/a'}`))

  await sleep(1000)
}

async function ensureServer() {
  try {
    await fetch(`${BASE}/api/sessions`)
  } catch {
    console.error(`\n\x1b[31mError: Agent server is not running at ${BASE}\x1b[0m`)
    console.error(`       Start it first in another terminal:`)
    console.error(`       npm run lesson10:agent\n`)
    process.exit(1)
  }
}

async function main() {
  console.log()
  console.log('========================================')
  console.log('  02_05 Agent — Continuity Demo')
  console.log(`  session: ${SESSION}`)
  console.log('========================================')

  await ensureServer()

  for (let i = 0; i < messages.length; i += 1) {
    await send(`${i + 1}/${messages.length}`, messages[i])
  }

  console.log()
  console.log(blue('━━━ Flushing remaining messages to observations ━━━━━━━━━━━'))
  const flush = await fetch(`${BASE}/api/sessions/${SESSION}/flush`, { method: 'POST' }).then((r) => r.json())
  const flushed = flush as { memory?: { sealedMessages?: number; activeMessages?: number; generation?: number; observationTokens?: number } }
  console.log(dim(`   sealed=${flushed.memory?.sealedMessages ?? '?'} active=${flushed.memory?.activeMessages ?? '?'} generation=${flushed.memory?.generation ?? '?'} tokens=${flushed.memory?.observationTokens ?? '?'}`))

  console.log()
  console.log(blue('━━━ Final Memory State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  const mem = await fetch(`${BASE}/api/sessions/${SESSION}/memory`).then((r) => r.json())
  console.log(JSON.stringify(mem, null, 2))
  console.log()
}

main().catch((err) => {
  console.error('Demo failed:', err)
  process.exit(1)
})
