import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { ENV } from '../config.js'
import { ensureWorkspaceInitialized } from '../bootstrap.js'
import { logger, ui } from '../logger.js'
import { createMcpManager } from '../mcp/client.js'
import { appendConversationLogs, historyToMessages, loadRecentHistory } from './chat-history.js'
import { createSession, runAwarenessTurn } from './agent.js'
import { loadAgentTemplate } from './template.js'

type MaybeMcp = Awaited<ReturnType<typeof createMcpManager>> | null

const isExitMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase()
  return normalized === 'exit' || normalized === 'quit' || normalized === '/exit' || normalized === '/quit'
}

const connectMcp = async (): Promise<MaybeMcp> => {
  try {
    return await createMcpManager(process.cwd())
  } catch (error) {
    logger.warn('mcp.unavailable', { error: String(error) })
    return null
  }
}

export const runCli = async (): Promise<void> => {
  await ensureWorkspaceInitialized()

  const sessionId = `awareness-${randomUUID()}`
  const history = await loadRecentHistory(ENV.historyWindow)
  const session = createSession(sessionId, historyToMessages(history))
  const template = await loadAgentTemplate('awareness')
  const mcp = await connectMcp()

  ui.banner(template.model, history.length)

  const rl = createInterface({ input, output })
  try {
    while (true) {
      const message = (await rl.question('you > ')).trim()
      if (!message) continue
      if (isExitMessage(message)) break

      const response = await runAwarenessTurn(session, message, mcp)
      ui.assistant(response.text)
      await appendConversationLogs(sessionId, message, response.text)
    }
  } finally {
    rl.close()
    if (mcp) await mcp.close()
  }
}
