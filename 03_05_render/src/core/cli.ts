import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { runAgentTurn } from './agent.js'
import type { LivePreviewServer } from './live-preview-server.js'
import { logger } from '../logger.js'

const isExitInput = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === 'exit' || normalized === 'quit' || normalized === '/exit' || normalized === '/quit'
}

const printBanner = (url: string): void => {
  console.log('')
  console.log('03_05 Render Agent')
  console.log(`Live preview: ${url}`)
  console.log("Type a prompt to chat or generate a render document, or 'exit' to quit.")
  console.log('')
}

export const runCli = async (preview: LivePreviewServer): Promise<void> => {
  const rl = createInterface({ input, output })
  printBanner(preview.url)

  try {
    while (true) {
      const raw = await rl.question('you > ')
      const prompt = raw.trim()
      if (!prompt) continue
      if (isExitInput(prompt)) break

      preview.updateState({
        status: 'loading',
        phase: 'interpreting_request',
        message: 'Starting agent turn...',
        lastPrompt: prompt,
        lastAssistantMessage: null,
        error: null,
      })

      try {
        const currentDocument = preview.getState().document
        const result = await runAgentTurn(prompt, {
          currentDocument,
          onProgress: (progress) => {
            preview.updateState({
              status: 'loading',
              phase: progress.phase,
              message: progress.message,
              lastPrompt: prompt,
              error: null,
            })
          },
        })

        if (result.kind === 'render') {
          preview.updateState({
            status: 'ready',
            phase: 'completed',
            message: `Rendered "${result.document.title}"`,
            lastPrompt: prompt,
            lastAssistantMessage: result.text,
            document: result.document,
            error: null,
          })

          logger.info('render.generated', {
            documentId: result.document.id,
            title: result.document.title,
            model: result.document.model,
            elements: Object.keys(result.document.spec.elements).length,
            packs: result.document.packs,
          })
        } else {
          preview.updateState({
            status: 'idle',
            phase: 'completed',
            message: 'No render generated in this turn.',
            lastPrompt: prompt,
            lastAssistantMessage: result.text,
            error: null,
          })
          logger.info('agent.chat_turn')
        }

        console.log(`agent > ${result.text}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        preview.updateState({
          status: 'error',
          phase: 'failed',
          message: 'Agent turn failed.',
          lastPrompt: prompt,
          lastAssistantMessage: null,
          error: message,
        })
        logger.error('agent.turn_failed', { error: message })
      }
    }
  } finally {
    rl.close()
  }
}
