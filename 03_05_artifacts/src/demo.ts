import { ENV } from './config.js'
import { logger } from './logger.js'
import { openBrowser } from './core/browser.js'
import { prewarmPackFiles } from './core/capabilities.js'
import { runCli, buildAgentContext } from './core/cli.js'
import { startLivePreviewServer } from './core/live-preview-server.js'
import { runAgent } from './core/agent.js'
import {
  buildDemoVisualizationPrompt,
  chooseDemoDataset,
  ensureDemoDatasets,
} from './core/demo-datasets.js'
import type { Message } from './types.js'

const serializeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

const main = async (): Promise<void> => {
  const preview = startLivePreviewServer({
    host: ENV.host,
    port: ENV.port,
  })

  logger.info('demo.preview_started', {
    url: preview.url,
    autoOpenBrowser: ENV.autoOpenBrowser,
    model: ENV.model,
  })

  await prewarmPackFiles()

  if (ENV.autoOpenBrowser) {
    openBrowser(preview.url)
  }

  try {
    preview.updateState({
      status: 'loading',
      phase: 'interpreting_request',
      message: 'Preparing demo datasets...',
      lastPrompt: null,
      lastAssistantMessage: null,
      error: null,
    })

    const seeded = await ensureDemoDatasets()
    const requestedDataset = process.env.DEMO_DATASET_FILE?.trim()
    const selected = await chooseDemoDataset(seeded, requestedDataset)
    const prompt = buildDemoVisualizationPrompt(
      selected,
      seeded.map((dataset) => dataset.filename),
    )

    logger.info('demo.dataset_selected', {
      filename: selected.filename,
      title: selected.title,
      bytes: selected.content.length,
      forced: Boolean(requestedDataset),
    })

    preview.updateState({
      status: 'loading',
      phase: 'interpreting_request',
      message: `Selected dataset: ${selected.filename}. Asking agent to visualize it...`,
      lastPrompt: `[demo] ${selected.filename}`,
      lastAssistantMessage: null,
      error: null,
    })

    const messages: Message[] = []
    const ctx = buildAgentContext(preview)
    const result = await runAgent(messages, prompt, ctx)

    const artifact = preview.getState().artifact
    if (!artifact) {
      throw new Error(`Demo expected artifact output, got: ${result.text}`)
    }

    preview.updateState({
      phase: 'completed',
      lastPrompt: `[demo] ${selected.filename}`,
      lastAssistantMessage: result.text,
    })

    logger.info('demo.artifact_ready', {
      filename: selected.filename,
      artifactId: artifact.id,
      title: artifact.title,
      packs: artifact.packs,
    })

    console.log('')
    console.log(`demo > dataset: ${selected.filename}`)
    console.log(`demo > objective: ${selected.objective}`)
    console.log(`agent > ${result.text}`)
    console.log('')

    await runCli(preview, { initialMessages: messages })
  } finally {
    preview.stop()
    logger.info('demo.preview_stopped')
  }
}

main().catch((error) => {
  logger.error('demo.failed', { error: serializeError(error) })
  process.exitCode = 1
})
