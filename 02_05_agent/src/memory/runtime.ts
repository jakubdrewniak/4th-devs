import type OpenAI from 'openai'
import type { MemoryConfig, Session } from '../types.js'
import { estimateTokens } from '../ai/tokens.js'
import { resolveModelForProvider } from '../config.js'
import { log } from '../helpers/log.js'
import { runObserver } from './observer.js'
import { runReflector } from './reflector.js'
import { splitByTailBudget } from './context.js'
import { persistObserverLog, persistReflectorLog } from './persistence.js'

const MIN_TAIL_BUDGET = 120
const OBSERVATION_TAIL_RATIO = 0.3

export const runObservation = async (
  openai: OpenAI,
  session: Session,
  config: MemoryConfig,
): Promise<void> => {
  const { messages, memory } = session
  const unobserved = messages.slice(memory.lastObservedIndex)

  const tailBudget = Math.max(MIN_TAIL_BUDGET, Math.floor(config.observationThresholdTokens * OBSERVATION_TAIL_RATIO))
  const { head } = splitByTailBudget(unobserved, tailBudget, memory.calibration)
  const toObserve = head.length > 0 ? head : unobserved

  const observed = await runObserver(
    openai,
    resolveModelForProvider(config.observerModel) as string,
    memory.activeObservations,
    toObserve,
  )

  if (!observed.observations) return

  const prevIndex = memory.lastObservedIndex

  memory.activeObservations = memory.activeObservations
    ? `${memory.activeObservations.trim()}\n\n${observed.observations.trim()}`
    : observed.observations.trim()
  memory.lastObservedIndex = head.length > 0
    ? memory.lastObservedIndex + head.length
    : messages.length
  memory.observationTokenCount = estimateTokens(memory.activeObservations, memory.calibration)

  const sealed = memory.lastObservedIndex - prevIndex
  log('memory', `Sealed ${sealed} messages (indices ${prevIndex}–${memory.lastObservedIndex - 1})`)
  log('memory', `Thread: ${memory.lastObservedIndex} sealed | ${messages.length - memory.lastObservedIndex} active`)

  memory.observerLogSeq += 1
  await persistObserverLog({
    sessionId: session.id,
    sequence: memory.observerLogSeq,
    observations: observed.observations,
    tokens: estimateTokens(observed.observations, memory.calibration),
    messagesObserved: toObserve.length,
    generation: memory.generationCount,
    sealedRange: [prevIndex, memory.lastObservedIndex - 1],
  })
}

export const runReflection = async (
  openai: OpenAI,
  session: Session,
  config: MemoryConfig,
): Promise<void> => {
  const { memory } = session

  log('memory', `Reflecting (${memory.observationTokenCount} > ${config.reflectionThresholdTokens})`)

  const reflected = await runReflector(
    openai,
    resolveModelForProvider(config.reflectorModel) as string,
    memory.activeObservations,
    config.reflectionTargetTokens,
    memory.calibration,
  )

  memory.activeObservations = reflected.observations
  memory.observationTokenCount = reflected.tokenCount
  memory._lastReflectionOutputTokens = reflected.tokenCount
  memory.generationCount += 1

  memory.reflectorLogSeq += 1
  await persistReflectorLog({
    sessionId: session.id,
    sequence: memory.reflectorLogSeq,
    observations: reflected.observations,
    tokens: reflected.tokenCount,
    generation: memory.generationCount,
    compressionLevel: reflected.compressionLevel,
  })
}
