import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { runAgentTurn } from './agent.js'
import { openBrowser } from './browser.js'
import { readListsState, summarizeLists, type ListsFilePaths } from './list-files.js'
import { logger } from '../logger.js'

interface RunCliInput extends ListsFilePaths {
  uiUrl: string
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
  console.log(`  ${dim('•')} Ask to open your ${bold('todo')} or ${bold('shopping')} list`)
  console.log(`  ${dim('•')} The browser UI will open so you can add, edit,`)
  console.log(`    check off, or delete items, then hit ${bold('Save')}`)
  console.log(`  ${dim('•')} Chat about anything — unrelated questions work too`)
  console.log(`  ${dim('•')} Type ${bold('exit')} or ${bold('quit')} to stop`)
  console.log('')
  console.log(line)
  console.log('')
}

const managerUrlForFocus = (baseUrl: string, focus: 'todo' | 'shopping'): string => {
  const url = new URL(baseUrl)
  url.searchParams.set('focus', focus)
  return url.toString()
}

export const runCli = async (options: RunCliInput): Promise<void> => {
  const rl = createInterface({ input, output })
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
        const currentState = await readListsState(options)
        const summary = summarizeLists(currentState)
        const result = await runAgentTurn(prompt, {
          listsSummary: summary,
        })

        if (result.kind === 'open_manager') {
          const url = managerUrlForFocus(options.uiUrl, result.focus)
          openBrowser(url)
          logger.info('manager.opened', { focus: result.focus, url })
        } else {
          logger.info('agent.chat_turn')
        }

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
