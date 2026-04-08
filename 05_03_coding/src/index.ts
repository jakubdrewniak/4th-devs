import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { runAgent } from './agent.js'
import { DEMO_TASK } from './config.js'
import { createSession, type Session } from './memory.js'
import { connectMcp } from './mcp.js'
import { consoleLogger, createSessionLogger, type SessionLogger } from './logger.js'

const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const WELCOME = `
========================================
  05_03 Coding Agent
========================================

  A small coding agent with:
  - an explicit agent loop
  - filesystem access via MCP
  - rolling memory
  - structured logs

  Commands:
    ${CYAN}/demo${RESET}   - Build a Snake game
    ${CYAN}/clear${RESET}  - Start a new session
    ${CYAN}/quit${RESET}   - Exit

  The agent works inside ${DIM}workspace/${RESET}.
`

const createRuntimeSession = (): { session: Session; logger: SessionLogger } => {
  const session = createSession(randomUUID())
  const logger = createSessionLogger(session.id)

  logger.info('cli', `Started session ${session.id.slice(0, 8)}`)
  return { session, logger }
}

const main = async () => {
  console.log(WELCOME)

  const rl = createInterface({ input, output, terminal: true })
  const mcp = await connectMcp('files', consoleLogger)
  let { session, logger } = createRuntimeSession()

  try {
    while (true) {
      let raw: string

      try {
        raw = await rl.question(`${CYAN}You:${RESET} `)
      } catch {
        break
      }

      const trimmed = raw.trim()

      if (!trimmed) {
        continue
      }

      if (trimmed === '/quit' || trimmed === '/exit') {
        break
      }

      if (trimmed === '/clear') {
        logger.info('cli', 'Session cleared')
        ;({ session, logger } = createRuntimeSession())
        console.log('')
        continue
      }

      const isDemo = trimmed === '/demo'
      const message = isDemo ? DEMO_TASK : trimmed

      try {
        const response = await runAgent({
          session,
          userMessage: message,
          mcp,
          logger,
        })

        console.log(`\n${GREEN}Agent:${RESET} ${response}\n`)

        if (isDemo) {
          console.log(`  ${DIM}To run the Snake game:${RESET}`)
          console.log(`  ${DIM}  cd workspace/snake${RESET}`)
          console.log(`  ${DIM}  bun install${RESET}`)
          console.log(`  ${DIM}  bun start${RESET}\n`)
        }
      } catch (error) {
        logger.error('cli', error, 'Request failed')
        console.error(`\n\x1b[31mError: ${error instanceof Error ? error.message : String(error)}\x1b[0m\n`)
      }
    }
  } finally {
    rl.close()
    await mcp.close()
  }
}

main().catch(error => {
  console.error('Fatal:', error)
  process.exit(1)
})
