/**
 * Memory processor — orchestrates the observer/reflector cycle.
 *
 * Based on Mastra's Observational Memory system.
 * https://mastra.ai/blog/observational-memory
 *
 * Context window layout:
 * ┌──────────────────────────────────────────────────────┐
 * │  Observations (system prompt)  │  Unobserved tail    │
 * │  Compressed history            │  Raw recent messages │
 * └──────────────────────────────────────────────────────┘
 */

import type OpenAI from 'openai'
import type { Session, MemoryConfig, ProcessedContext } from '../types.js'
import { estimateMessagesTokensRaw } from '../ai/tokens.js'
import { DEFAULT_MEMORY_CONFIG } from '../config.js'
import { log, logError } from '../helpers/log.js'
import { buildObservedContext, buildPassthroughContext } from './context.js'
import { runObservation, runReflection } from './runtime.js'

// ============================================================================
// Main entry point — called before each provider call in the agent loop
// ============================================================================

/**
 * Core memory processor.
 *
 * 1. Below threshold → pass through (observations in system prompt if they exist)
 * 2. Above threshold → observer seals head, keeps tail
 * 3. Observations too large → reflector compresses
 *
 * Observer runs at most once per HTTP request (flag on session.memory).
 */
export const processMemory = async (
  openai: OpenAI,
  session: Session,
  baseSystemPrompt: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<ProcessedContext> => {
  const { messages, memory } = session
  const unobserved = messages.slice(memory.lastObservedIndex)
  const pendingTokens = estimateMessagesTokensRaw(unobserved)

  log('memory', `Pending: ${pendingTokens} tokens (${unobserved.length} msgs) | Observations: ${memory.observationTokenCount} tokens (gen ${memory.generationCount})`)

  if (pendingTokens < config.observationThresholdTokens) {
    return buildPassthroughContext(session, baseSystemPrompt)
  }

  if (memory._observerRanThisRequest) {
    log('memory', `Observer already ran this request, skipping`)
    return buildPassthroughContext(session, baseSystemPrompt)
  }

  log('memory', `Threshold exceeded (${pendingTokens} >= ${config.observationThresholdTokens}), running observer`)

  try {
    await runObservation(openai, session, config)
    memory._observerRanThisRequest = true
  } catch (err) {
    logError('memory', 'Observer failed:', err)
    return { systemPrompt: baseSystemPrompt, messages }
  }

  const grewSinceReflection = memory.observationTokenCount - (memory._lastReflectionOutputTokens ?? 0)
  const shouldReflect = memory.observationTokenCount > config.reflectionThresholdTokens
    && grewSinceReflection >= config.reflectionTargetTokens

  if (shouldReflect) {
    try {
      await runReflection(openai, session, config)
    } catch (err) {
      logError('memory', 'Reflector failed:', err)
    }
  } else if (memory.observationTokenCount > config.reflectionThresholdTokens) {
    log('memory', `Skipping reflection (grew ${grewSinceReflection} tokens since last, need ${config.reflectionTargetTokens})`)
  }

  const context = buildObservedContext(session, baseSystemPrompt)
  log('memory', `Context: ${context.messages.length} active msgs + observations (gen ${memory.generationCount}) | ${memory.lastObservedIndex} sealed`)
  return context
}

// ============================================================================
// Flush — force-observe remaining messages at end of session/demo
// ============================================================================

export const flushMemory = async (
  openai: OpenAI,
  session: Session,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<void> => {
  const { messages, memory } = session
  const unobserved = messages.slice(memory.lastObservedIndex)
  if (unobserved.length === 0) return

  log('flush', `Observing ${unobserved.length} remaining messages`)

  await runObservation(openai, session, config)

  if (memory.observationTokenCount > config.reflectionThresholdTokens) {
    try {
      await runReflection(openai, session, config)
    } catch (err) {
      logError('flush', 'Reflector failed:', err)
    }
  }
}
