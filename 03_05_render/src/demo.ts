import { ENV } from './config.js'
import { logger } from './logger.js'
import { openBrowser } from './core/browser.js'
import { runCli } from './core/cli.js'
import { startLivePreviewServer } from './core/live-preview-server.js'
import { generateRenderDocument } from './core/spec-generator.js'
import {
  buildDemoRenderPrompt,
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
    const prompt = buildDemoRenderPrompt(
      selected,
      seeded.map((dataset) => dataset.filename),
    )

    logger.info('demo.dataset_selected', {
      filename: selected.filename,
      title: selected.title,
      bytes: selected.content.length,
      forced: Boolean(requestedDataset),
      suggestedPacks: selected.suggestedPacks,
    })

    preview.updateState({
      status: 'loading',
      phase: 'interpreting_request',
      message: `Selected dataset: ${selected.filename}. Generating render document...`,
      lastPrompt: `[demo] ${selected.filename}`,
      lastAssistantMessage: null,
      error: null,
    })

    const document = await generateRenderDocument(
      {
        prompt,
        packs: selected.suggestedPacks,
      },
      {
        onProgress: (progress) => {
          preview.updateState({
            status: 'loading',
            phase: progress.phase,
            message: progress.message,
            lastPrompt: `[demo] ${selected.filename}`,
            error: null,
          })
        },
      },
    )

    const summaryText = document.summary
      ? `Demo rendered ${selected.filename}: ${document.summary}`
      : `Demo rendered ${selected.filename} using "${document.title}".`

    preview.updateState({
      status: 'ready',
      phase: 'completed',
      message: `Demo rendered ${selected.filename} using "${document.title}"`,
      lastPrompt: `[demo] ${selected.filename}`,
      lastAssistantMessage: summaryText,
      document,
      error: null,
    })

    logger.info('demo.document_ready', {
      filename: selected.filename,
      documentId: document.id,
      title: document.title,
      packs: document.packs,
      elements: Object.keys(document.spec.elements).length,
    })

    console.log('')
    console.log(`demo > dataset: ${selected.filename}`)
    console.log(`demo > objective: ${selected.objective}`)
    console.log(`demo > title: ${document.title}`)
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
