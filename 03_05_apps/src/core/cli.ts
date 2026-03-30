import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { runAgent } from './agent.js'
import { logger } from '../logger.js'
import type { AgentContext, Message } from '../types.js'

export interface RunCliInput extends AgentContext {
  mcpUrl: string
}

const isExitInput = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === 'exit' || normalized === 'quit' || normalized === '/exit' || normalized === '/quit'
}

const printBanner = (uiUrl: string, mcpUrl: string): void => {
  const dim = (text: string) => `\x1b[2m${text}\x1b[0m`
  const bold = (text: string) => `\x1b[1m${text}\x1b[0m`
  const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`
  const line = dim('─'.repeat(52))

  console.log('')
  console.log(line)
  console.log(bold('  List Manager — Todo & Shopping'))
  console.log(line)
  console.log('')
  console.log(`  ${dim('Browser UI')}    ${cyan(uiUrl)}`)
  console.log(`  ${dim('MCP endpoint')}  ${cyan(mcpUrl)}`)
  console.log('')
  console.log(dim('  What you can do:'))
  console.log(`  ${dim('•')} Manage your ${bold('todo')} and ${bold('shopping')} lists via chat`)
  console.log(`  ${dim('•')} Ask the agent to add, remove, or check off items`)
  console.log(`  ${dim('•')} Ask to ${bold('open')} the browser UI for interactive editing`)
  console.log(`  ${dim('•')} Chat about anything — unrelated questions work too`)
  console.log(`  ${dim('•')} Type ${bold('exit')} or ${bold('quit')} to stop`)
  console.log('')
  console.log(line)
  console.log('')
}

export const runCli = async (options: RunCliInput): Promise<void> => {
  const rl = createInterface({ input, output })
  const messages: Message[] = []
  const ctx: AgentContext = {
    todoFilePath: options.todoFilePath,
    shoppingFilePath: options.shoppingFilePath,
    uiUrl: options.uiUrl,
  }

  printBanner(options.uiUrl, options.mcpUrl)

  try {
    while (true) {
      let raw: string
      try {
        raw = await rl.question('you > ')
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes('readline was closed')) {
          break
        }
        throw error
      }

      const prompt = raw.trim()
      if (!prompt) continue
      if (isExitInput(prompt)) break

      try {
        const result = await runAgent(messages, prompt, ctx)
        console.log(`agent > ${result.text}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('agent.turn_failed', { error: message })
        console.log(`agent > Failed: ${message}`)
      }
    }
  } finally {
    rl.close()
  }
}
