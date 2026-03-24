import { extname } from 'node:path'
import { PATHS } from '../config/index.js'
import { asRelativeSafePath, asRelativeSafePaths, slugify } from '../helpers/paths.js'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export const WORKSPACE_DIR = PATHS.WORKSPACE_DIR
export const IMAGE_ASSETS_DIR = 'assets'

export const asWorkspaceSafePath = (value: unknown): string | null =>
  asRelativeSafePath(WORKSPACE_DIR, value)

export const asWorkspaceSafePaths = (value: unknown): string[] =>
  asRelativeSafePaths(WORKSPACE_DIR, value)

export const toSlug = (value: string): string => slugify(value)

export const getImageMimeType = (path: string): string => {
  const extension = extname(path).toLowerCase()
  return MIME_TYPES[extension] ?? 'image/png'
}
