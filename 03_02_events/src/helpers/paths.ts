import { join, relative, resolve, sep } from 'node:path'

export const isPathSafe = (baseDir: string, path: string): boolean => {
  const fullPath = resolve(join(baseDir, path))
  const rel = relative(resolve(baseDir), fullPath)
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

export const asRelativeSafePath = (baseDir: string, path: unknown): string | null => {
  if (typeof path !== 'string' || !path.trim()) return null
  const trimmed = path.trim()
  return isPathSafe(baseDir, trimmed) ? trimmed : null
}

export const asRelativeSafePaths = (baseDir: string, value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => asRelativeSafePath(baseDir, item))
    .filter((item): item is string => item != null)
}

export const isPlainMarkdownFilename = (value: string): boolean =>
  value.endsWith('.md') &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes('..')

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
