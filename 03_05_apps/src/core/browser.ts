import { logger } from '../logger.js'

const buildOpenCommand = (url: string): string[] => {
  switch (process.platform) {
    case 'darwin':
      return ['open', url]
    case 'win32':
      return ['cmd', '/c', 'start', '', url]
    default:
      return ['xdg-open', url]
  }
}

export const openBrowser = (url: string): void => {
  const command = buildOpenCommand(url)
  try {
    Bun.spawn(command, {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      onExit(_, exitCode) {
        if (exitCode !== 0) {
          logger.warn('browser.open_failed', { command: command.join(' '), exitCode })
        }
      },
    })
  } catch (error) {
    logger.warn('browser.open_failed', {
      command: command.join(' '),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
