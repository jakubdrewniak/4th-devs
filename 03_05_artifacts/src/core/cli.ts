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
  const dim = (text: string) => `\x1b[2m${text}\x1b[0m`
  const bold = (text: string) => `\x1b[1m${text}\x1b[0m`
  const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`
  const line = dim('─'.repeat(52))

  console.log('')
  console.log(line)
  console.log(bold('  Artifacts Agent — Live HTML Preview'))
  console.log(line)
  console.log('')
  console.log(`  ${dim('Live preview')}  ${cyan(url)}`)
  console.log('')
  console.log(dim('  What you can do:'))
  console.log(`  ${dim('•')} Describe a UI and get a ${bold('live HTML artifact')}`)
  console.log(`  ${dim('•')} Ask to ${bold('edit')} the current artifact iteratively`)
  console.log(`  ${dim('•')} Chat freely — not every prompt needs an artifact`)
  console.log(`  ${dim('•')} Type ${bold('exit')} or ${bold('quit')} to stop`)
  console.log('')
  console.log(line)
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
        const currentArtifact = preview.getState().artifact
        const result = await runAgentTurn(prompt, {
          currentArtifact,
          serverBaseUrl: preview.url,
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

        if (result.kind === 'artifact') {
          preview.updateState({
            status: 'ready',
            phase: 'completed',
            message: result.action === 'edited'
              ? `Updated "${result.artifact.title}"`
              : `Rendered "${result.artifact.title}"`,
            lastPrompt: prompt,
            lastAssistantMessage: result.text,
            artifact: result.artifact,
            error: null,
          })

          logger.info(result.action === 'edited' ? 'artifact.edited' : 'artifact.generated', {
            artifactId: result.artifact.id,
            title: result.artifact.title,
            model: result.artifact.model,
            htmlChars: result.artifact.html.length,
            packs: result.artifact.packs,
          })
        } else {
          preview.updateState({
            status: 'idle',
            phase: 'completed',
            message: 'No artifact generated in this turn.',
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
