import { ENV } from './config.js'
import { logger } from './logger.js'
import { openBrowser } from './core/browser.js'
import { runCli } from './core/cli.js'
import { ensureListFiles } from './core/list-files.js'
import { startMcpAppServer } from './core/mcp-app-server.js'
import { startUiServer } from './core/ui-server.js'

const serializeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

const main = async (): Promise<void> => {
  const listPaths = {
    todoFilePath: ENV.todoFilePath,
    shoppingFilePath: ENV.shoppingFilePath,
  }

  await ensureListFiles(listPaths)

  const ui = startUiServer({
    ...listPaths,
    host: ENV.host,
    port: ENV.uiPort,
  })

  const mcp = startMcpAppServer({
    ...listPaths,
    host: ENV.host,
    port: ENV.mcpPort,
    resourceUri: ui.resourceUri,
  })

  logger.info('servers.started', {
    uiUrl: ui.url,
    mcpUrl: mcp.url,
    todoFilePath: ENV.todoFilePath,
    shoppingFilePath: ENV.shoppingFilePath,
    model: ENV.model,
  })

  if (ENV.autoOpenBrowser) {
    openBrowser(ui.url)
  }

  try {
    await runCli({
      ...listPaths,
      uiUrl: ui.url,
      mcpUrl: mcp.url,
    })
  } finally {
    ui.stop()
    mcp.stop()
    logger.info('servers.stopped')
  }
}

main().catch((error) => {
  logger.error('index.failed', { error: serializeError(error) })
  process.exitCode = 1
})
