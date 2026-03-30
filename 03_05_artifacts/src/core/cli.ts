import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { runAgent } from './agent.js'
import type { LivePreviewServer } from './live-preview-server.js'
import type { AgentContext, Message } from '../types.js'
import { logger } from '../logger.js'

interface RunCliOptions {
  initialMessages?: Message[]
}

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

export const buildAgentContext = (preview: LivePreviewServer): AgentContext => ({
  serverBaseUrl: preview.url,
  getCurrentArtifact: () => preview.getState().artifact,
  onArtifactChanged: (artifact, action) => {
    preview.updateState({
      status: 'ready',
      phase: 'completed',
      message: action === 'edited' ? `Updated "${artifact.title}"` : `Rendered "${artifact.title}"`,
      artifact,
      error: null,
    })
    logger.info(action === 'edited' ? 'artifact.edited' : 'artifact.generated', {
      artifactId: artifact.id,
      title: artifact.title,
      model: artifact.model,
      htmlChars: artifact.html.length,
      packs: artifact.packs,
    })
  },
  onProgress: (progress) => {
    preview.updateState({
      status: 'loading',
      phase: progress.phase,
      message: progress.message,
      error: null,
    })
  },
})

export const runCli = async (preview: LivePreviewServer, options: RunCliOptions = {}): Promise<void> => {
  const rl = createInterface({ input, output })
  const messages: Message[] = options.initialMessages ?? []
  const ctx = buildAgentContext(preview)

  printBanner(preview.url)

  try {
    while (true) {
      let raw: string
      try {
        raw = await rl.question('you > ')
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes('readline was closed')) break
        throw error
      }

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
        const result = await runAgent(messages, prompt, ctx)
        const currentState = preview.getState()
        preview.updateState({
          status: currentState.artifact ? 'ready' : 'idle',
          phase: 'completed',
          message: 'Agent turn completed.',
          lastPrompt: prompt,
          lastAssistantMessage: result.text,
          error: null,
        })
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
        console.log(`agent > Failed: ${message}`)
      }
    }
  } finally {
    rl.close()
  }
}
