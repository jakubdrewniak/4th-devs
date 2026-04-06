/**
 * Reflector — compresses observations when they exceed the token budget.
 *
 * Adapted from Mastra's Observational Memory system.
 * https://mastra.ai/blog/observational-memory
 */

import type { TokenUsage } from '../domain.js'
import { emptyUsage, addUsage } from '../domain.js'
import { generateText } from '../ai/index.js'
import { estimateTokens } from './observer.js'

export interface ReflectorResult {
  observations: string
  tokenCount: number
  compressionLevel: number
  usage: TokenUsage
}

const COMPRESSION_LEVELS = [
  '',
  'Condense older observations more aggressively. Preserve detail for recent ones only.',
  'Heavily condense. Remove redundancy, keep only durable facts, active commitments, and blockers.',
] as const

const SYSTEM_PROMPT = `You are the observation reflector of a multi-agent task system.
You must reorganize and compress observations while preserving continuity.

Rules:
1) Your output is the ENTIRE memory. Anything omitted is forgotten.
2) Keep user goals and completed deliverables as highest priority.
3) Keep active tasks, blockers, and artifact references.
4) Condense older details first. Preserve recent details more strongly.
5) Resolve contradictions by preferring newer observations.
6) Output only compressed observations in XML:

<observations> ... </observations>`.trim()

const buildPrompt = (observations: string, guidance: string): string =>
  [
    'Compress and reorganize the observation memory below.',
    guidance ? `Additional guidance: ${guidance}` : '',
    '',
    '<observations>',
    observations,
    '</observations>',
  ]
    .filter(Boolean)
    .join('\n')

const extractTag = (text: string, tag: string): string | undefined => {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.trim() || undefined
}

export const runReflector = async (
  observations: string,
  targetTokens: number,
): Promise<ReflectorResult> => {
  let bestObservations = observations
  let bestTokens = estimateTokens(observations)
  let bestLevel = -1
  let cumulative = emptyUsage()

  for (let level = 0; level < COMPRESSION_LEVELS.length; level++) {
    const result = await generateText({
      instructions: SYSTEM_PROMPT,
      input: buildPrompt(observations, COMPRESSION_LEVELS[level]),
    })

    if (result.usage) cumulative = addUsage(cumulative, result.usage)

    const compressed = extractTag(result.text, 'observations') ?? result.text.trim()
    if (!compressed) continue

    const tokens = estimateTokens(compressed)
    if (tokens < bestTokens) {
      bestObservations = compressed
      bestTokens = tokens
      bestLevel = level
    }

    if (tokens <= targetTokens) {
      return { observations: compressed, tokenCount: tokens, compressionLevel: level, usage: cumulative }
    }
  }

  return { observations: bestObservations, tokenCount: bestTokens, compressionLevel: bestLevel, usage: cumulative }
}
