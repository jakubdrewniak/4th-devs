import { randomUUID } from 'node:crypto'
import type { ArtifactDocument, SearchReplaceOperation } from '../types.js'

interface EditArtifactInput {
  artifact: ArtifactDocument
  replacements: SearchReplaceOperation[]
  instructions: string
  title?: string
}

interface ReplacementReport {
  index: number
  search: string
  matches: number
}

export interface EditArtifactResult {
  artifact: ArtifactDocument
  reports: ReplacementReport[]
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const uniqueFlags = (flags: string): string => Array.from(new Set(flags.split(''))).join('')

const sanitizeRegexFlags = (flags: string | undefined): string => {
  if (!flags) return ''
  return uniqueFlags(flags.replace(/[^dgimsuvy]/g, ''))
}

const toRegex = (operation: SearchReplaceOperation): RegExp => {
  if (operation.search.length === 0) {
    throw new Error('Replacement search value cannot be empty.')
  }

  const baseFlags = sanitizeRegexFlags(operation.regexFlags)
  const withCaseFlag = operation.caseSensitive === false && !baseFlags.includes('i')
    ? `${baseFlags}i`
    : baseFlags
  const effectiveFlags = operation.replaceAll === true
    ? (withCaseFlag.includes('g') ? withCaseFlag : `${withCaseFlag}g`)
    : withCaseFlag.replaceAll('g', '')

  const pattern = operation.useRegex === true
    ? operation.search
    : escapeRegExp(operation.search)

  return new RegExp(pattern, uniqueFlags(effectiveFlags))
}

const countMatches = (source: string, regex: RegExp, replaceAll: boolean): number => {
  if (replaceAll) {
    const iterableRegex = regex.flags.includes('g') ? regex : new RegExp(regex.source, `${regex.flags}g`)
    return Array.from(source.matchAll(iterableRegex)).length
  }
  return regex.test(source) ? 1 : 0
}

const applyOneReplacement = (
  source: string,
  operation: SearchReplaceOperation,
): { next: string; matches: number } => {
  const regex = toRegex(operation)
  const matches = countMatches(source, regex, operation.replaceAll === true)
  if (matches === 0) {
    return { next: source, matches: 0 }
  }
  const next = source.replace(regex, operation.replace)
  return { next, matches }
}

export const editArtifactWithSearchReplace = ({
  artifact,
  replacements,
  instructions,
  title,
}: EditArtifactInput): EditArtifactResult => {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error('At least one search/replace operation is required.')
  }

  let html = artifact.html
  const reports: ReplacementReport[] = []

  replacements.forEach((operation, index) => {
    const search = operation.search ?? ''
    const replace = operation.replace ?? ''
    const normalizedOperation: SearchReplaceOperation = {
      ...operation,
      search: String(search),
      replace: String(replace),
    }
    const result = applyOneReplacement(html, normalizedOperation)
    html = result.next
    reports.push({
      index: index + 1,
      search: normalizedOperation.search,
      matches: result.matches,
    })
  })

  const nextTitle = typeof title === 'string' && title.trim().length > 0
    ? title.trim()
    : artifact.title

  return {
    artifact: {
      ...artifact,
      id: randomUUID(),
      title: nextTitle,
      prompt: instructions.trim().length > 0 ? instructions.trim() : artifact.prompt,
      html,
      model: 'edit-search-replace',
      createdAt: new Date().toISOString(),
    },
    reports,
  }
}
