import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback

export const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export const asChartRows = (value: unknown): Array<{ label: string; value: number; note?: string }> =>
  Array.isArray(value)
    ? value.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return []
        }

        const candidate = item as Record<string, unknown>
        const label = asString(candidate.label)
        const numericValue = asNumber(candidate.value, Number.NaN)
        const note = asString(candidate.note)

        if (!label || !Number.isFinite(numericValue)) {
          return []
        }

        return [{ label, value: numericValue, ...(note ? { note } : {}) }]
      })
    : []

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'artifact'

export const stringifyOutput = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const persistFile = async (
  dataDir: string,
  relativePath: string,
  content: string,
): Promise<string> => {
  const filePath = path.join(dataDir, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return relativePath
}

export const createChartPreview = (
  title: string,
  rows: Array<{ label: string; value: number; note?: string }>,
): string => {
  const table = rows
    .map(row => `| ${row.label} | $${row.value.toLocaleString()} |`)
    .join('\n')
  const notes = rows
    .filter(row => row.note)
    .map(row => `- ${row.label}: ${row.note}`)
    .join('\n')

  return [
    `## ${title}`,
    '',
    '| Item | Value |',
    '| --- | ---: |',
    table,
    notes ? '' : null,
    notes || null,
  ].filter((part): part is string => Boolean(part)).join('\n')
}
