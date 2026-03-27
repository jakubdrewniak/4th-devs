import { ENV } from './config.js'
import { logger } from './logger.js'
import { openBrowser } from './core/browser.js'
import { prewarmPackFiles } from './core/capabilities.js'
import { runCli } from './core/cli.js'
import { startLivePreviewServer } from './core/live-preview-server.js'
import { runAgentTurn } from './core/agent.js'
import {
  buildDemoVisualizationPrompt,
  chooseDemoDataset,
  ensureDemoDatasets,
} from './core/demo-datasets.js'

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

    const initialResult = await runAgentTurn(prompt, {
      currentArtifact: null,
      serverBaseUrl: preview.url,
      onProgress: (progress) => {
        preview.updateState({
          status: 'loading',
          phase: progress.phase,
          message: progress.message,
          lastPrompt: `[demo] ${selected.filename}`,
          error: null,
        })
      },
    })

    if (initialResult.kind !== 'artifact') {
      throw new Error(`Demo expected artifact output, got chat output: ${initialResult.text}`)
    }

    preview.updateState({
      status: 'ready',
      phase: 'completed',
      message: `Demo rendered ${selected.filename} using "${initialResult.artifact.title}"`,
      lastPrompt: `[demo] ${selected.filename}`,
      lastAssistantMessage: initialResult.text,
      artifact: initialResult.artifact,
      error: null,
    })

    logger.info('demo.artifact_ready', {
      filename: selected.filename,
      artifactId: initialResult.artifact.id,
      title: initialResult.artifact.title,
      packs: initialResult.artifact.packs,
      action: initialResult.action,
    })

    console.log('')
    console.log(`demo > dataset: ${selected.filename}`)
    console.log(`demo > objective: ${selected.objective}`)
    console.log(`agent > ${initialResult.text}`)
    console.log('')

    await runCli(preview)
  } finally {
    preview.stop()
    logger.info('demo.preview_stopped')
  }
}

main().catch((error) => {
  logger.error('demo.failed', { error: serializeError(error) })
  process.exitCode = 1
})
