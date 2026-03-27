import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_UI_BUILD_PATH = resolve(process.cwd(), 'dist/ui/index.html')

const resolveUiBuildPath = (): string => {
  const configuredPath = process.env.APPS_UI_BUILD_FILE?.trim()
  if (!configuredPath) return DEFAULT_UI_BUILD_PATH
  return configuredPath.startsWith('/') ? configuredPath : resolve(process.cwd(), configuredPath)
}

export const renderListManagerHtml = async (): Promise<string> => {
  const filePath = resolveUiBuildPath()

  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `UI bundle not found at "${filePath}". Run "bun run build:ui" before starting the server.`,
      )
    }
    throw error
  }
}
