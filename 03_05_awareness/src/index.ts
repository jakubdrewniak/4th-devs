import { logger } from './logger.js'
import { runCli } from './core/cli.js'

const serializeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

const main = async (): Promise<void> => {
  // Composition root: wire runtime and run interactive CLI.
  await runCli()
}

main().catch((error) => {
  logger.error('index.failed', { error: serializeError(error) })
  process.exitCode = 1
})
