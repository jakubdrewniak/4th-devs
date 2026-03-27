import { ENV } from './config.js'
import { logger } from './logger.js'
import { openBrowser } from './core/browser.js'
import { prewarmPackFiles } from './core/capabilities.js'
import { runCli } from './core/cli.js'
import { startLivePreviewServer } from './core/live-preview-server.js'

const serializeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

const main = async (): Promise<void> => {
  const preview = startLivePreviewServer({
    host: ENV.host,
    port: ENV.port,
  })

  logger.info('preview.started', {
    url: preview.url,
    autoOpenBrowser: ENV.autoOpenBrowser,
    model: ENV.model,
  })

  await prewarmPackFiles()

  if (ENV.autoOpenBrowser) {
    openBrowser(preview.url)
  }

  try {
    await runCli(preview)
  } finally {
    preview.stop()
    logger.info('preview.stopped')
  }
}

main().catch((error) => {
  logger.error('index.failed', { error: serializeError(error) })
  process.exitCode = 1
})
