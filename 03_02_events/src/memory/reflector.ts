/**
 * Reflector — compresses and reorganizes observations when they exceed token budget.
 *
 * Based on Mastra's Observational Memory system.
 * https://mastra.ai/blog/observational-memory
 */

import OpenAI from 'openai'
import { logger } from '../core/logger.js'
import { estimateTokens } from '../helpers/tokens.js'

const REFLECTOR_MAX_OUTPUT_TOKENS = 10_000

const COMPRESSION_LEVELS = [
  '',
  'Condense older observations more aggressively. Preserve detail for recent ones only.',
  'Heavily condense. Remove redundancy, keep only durable facts, active commitments, and blockers.',
] as const

export interface ReflectorResult {
  observations: string
  tokenCount: number
  raw: string
  compressionLevel: number
}

const SYSTEM_PROMPT = `You are the observation reflector — part of the memory consciousness.

You must reorganize and compress observations while preserving continuity.

Rules:
1) Your output is the ENTIRE memory. Anything omitted is forgotten.
2) Keep user assertions and stable preferences as highest priority.
3) Keep active tasks, blockers, and unresolved commitments.
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
  openai: OpenAI,
  model: string,
  observations: string,
  targetTokens: number,
): Promise<ReflectorResult> => {
  let bestObservations = observations
  let bestTokens = estimateTokens(observations)
  let bestRaw = observations
  let bestLevel = -1

  logger.info('memory.reflector.started', {
    current_tokens: bestTokens,
    target_tokens: targetTokens,
  })

  for (let level = 0; level < COMPRESSION_LEVELS.length; level += 1) {
    const response = await openai.chat.completions.create(
      {
        model,
        temperature: 0,
        max_completion_tokens: REFLECTOR_MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(observations, COMPRESSION_LEVELS[level]) },
        ],
      },
      { signal: AbortSignal.timeout(30_000) },
    )

    const raw = response.choices[0]?.message?.content ?? ''
    const compressed = extractTag(raw, 'observations') ?? raw.trim()
    if (!compressed) continue

    const tokens = estimateTokens(compressed)
    if (tokens < bestTokens) {
      bestObservations = compressed
      bestTokens = tokens
      bestRaw = raw
      bestLevel = level
    }

    if (tokens <= targetTokens) {
      logger.info('memory.reflector.completed', { token_count: tokens, compression_level: level })
      return { observations: compressed, tokenCount: tokens, raw, compressionLevel: level }
    }
  }

  logger.info('memory.reflector.best-effort', { token_count: bestTokens, compression_level: bestLevel })
  return {
    observations: bestObservations,
    tokenCount: bestTokens,
    raw: bestRaw,
    compressionLevel: bestLevel,
  }
}
