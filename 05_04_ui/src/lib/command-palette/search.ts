import type { CommandItem, MatchRange, ScoredCommandItem } from './types'

const SCORE_EXACT_START = 100
const SCORE_WORD_BOUNDARY = 60
const SCORE_CONTIGUOUS = 40
const SCORE_SUBSTRING = 20
const SCORE_KEYWORD = 10

const findContiguousMatch = (
  haystack: string,
  needle: string,
): { index: number; score: number } | null => {
  const lower = haystack.toLowerCase()
  const index = lower.indexOf(needle)

  if (index < 0) {
    return null
  }

  if (index === 0) {
    return { index, score: SCORE_EXACT_START }
  }

  const charBefore = haystack[index - 1]
  const isWordBoundary = charBefore === ' ' || charBefore === '-' || charBefore === '_'

  return { index, score: isWordBoundary ? SCORE_WORD_BOUNDARY : SCORE_SUBSTRING }
}

const scoreLabel = (
  label: string,
  query: string,
): { score: number; matchRanges: MatchRange[] } | null => {
  const match = findContiguousMatch(label, query)
  if (!match) {
    return null
  }

  return {
    score: match.score + (query.length / label.length) * SCORE_CONTIGUOUS,
    matchRanges: [{ start: match.index, end: match.index + query.length }],
  }
}

const scoreKeywords = (keywords: string[], query: string): number => {
  for (const keyword of keywords) {
    if (keyword.toLowerCase().includes(query)) {
      return SCORE_KEYWORD
    }
  }
  return 0
}

export const searchCommands = (
  query: string,
  items: readonly CommandItem[],
): ScoredCommandItem[] => {
  const trimmed = query.trim().toLowerCase()

  if (trimmed === '') {
    return items
      .filter((item) => item.enabled())
      .map((item) => ({ item, score: 0, matchRanges: [] }))
  }

  const results: ScoredCommandItem[] = []

  for (const item of items) {
    if (!item.enabled()) {
      continue
    }

    const labelResult = scoreLabel(item.label, trimmed)
    if (labelResult) {
      results.push({ item, score: labelResult.score, matchRanges: labelResult.matchRanges })
      continue
    }

    const keywordScore = item.keywords ? scoreKeywords(item.keywords, trimmed) : 0
    if (keywordScore > 0) {
      results.push({ item, score: keywordScore, matchRanges: [] })
    }
  }

  results.sort((a, b) => b.score - a.score)

  return results
}
