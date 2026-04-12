export type LargeTextPasteFormat = 'markdown' | 'text'

export interface LargeTextPasteAttachment {
  characterCount: number
  file: File
  fileName: string
  threshold: number
}

export const LARGE_TEXT_PASTE_THRESHOLD = 12_000

export interface LargeTextPasteMetadataEntry {
  characterCount: number
  fileId: string
  fileName: string
}

const LARGE_TEXT_PASTE_METADATA_START = '<!-- large-paste:metadata:start -->'
const LARGE_TEXT_PASTE_METADATA_END = '<!-- large-paste:metadata:end -->'

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n')

const pad = (value: number): string => String(value).padStart(2, '0')
const padMilliseconds = (value: number): string => String(value).padStart(3, '0')

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const formatFileStamp = (value: Date): string =>
  `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}-${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}${padMilliseconds(value.getUTCMilliseconds())}`

const LARGE_TEXT_PASTE_METADATA_PATTERN = new RegExp(
  `${escapeRegex(LARGE_TEXT_PASTE_METADATA_START)}[\\s\\S]*?${escapeRegex(LARGE_TEXT_PASTE_METADATA_END)}`,
  'g',
)

export const shouldUploadLargeTextPaste = (
  value: string,
  threshold = LARGE_TEXT_PASTE_THRESHOLD,
): boolean => normalizeLineEndings(value ?? '').length >= threshold

export const buildLargeTextPasteHiddenMetadata = (
  entries: LargeTextPasteMetadataEntry[],
  threshold = LARGE_TEXT_PASTE_THRESHOLD,
): string => {
  if (entries.length === 0) {
    return ''
  }

  const lines = [LARGE_TEXT_PASTE_METADATA_START, '<metadata>']

  for (const entry of entries) {
    lines.push(
      `Large pasted text was uploaded as attachment "${entry.fileName}" with file id "${entry.fileId}" because it exceeded the inline paste threshold (${threshold} characters).`,
    )
    lines.push(
      `Pasted payload size: ${entry.characterCount} characters. Use native file tools to read file "${entry.fileId}" instead of relying on inline message text.`,
    )
  }

  lines.push('</metadata>', LARGE_TEXT_PASTE_METADATA_END)
  return lines.join('\n')
}

export const appendLargeTextPasteHiddenMetadata = (
  value: string,
  entries: LargeTextPasteMetadataEntry[],
  threshold = LARGE_TEXT_PASTE_THRESHOLD,
): string => {
  const fragment = buildLargeTextPasteHiddenMetadata(entries, threshold)
  if (!fragment) {
    return value
  }

  const trimmedValue = value.trimEnd()
  return trimmedValue.length > 0 ? `${trimmedValue}\n\n${fragment}` : fragment
}

export const stripLargeTextPasteHiddenMetadata = (value: string): string =>
  normalizeLineEndings(value ?? '')
    .replace(LARGE_TEXT_PASTE_METADATA_PATTERN, '')
    .trim()

export const createLargeTextPasteAttachment = (
  text: string,
  options: {
    format?: LargeTextPasteFormat
    now?: Date
    threshold?: number
  } = {},
): LargeTextPasteAttachment => {
  const format = options.format ?? 'text'
  const now = options.now ?? new Date()
  const threshold = options.threshold ?? LARGE_TEXT_PASTE_THRESHOLD
  const normalizedText = normalizeLineEndings(text ?? '')
  const fileExtension = format === 'markdown' ? 'md' : 'txt'
  const mimeType = format === 'markdown' ? 'text/markdown' : 'text/plain'
  const fileName = `pasted-text-${formatFileStamp(now)}.${fileExtension}`

  return {
    characterCount: normalizedText.length,
    file: new File([normalizedText], fileName, { type: mimeType }),
    fileName,
    threshold,
  }
}
