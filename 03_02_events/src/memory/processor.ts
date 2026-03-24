/**
 * Memory processor — orchestrates observer/reflector cycle.
 *
 * Based on Mastra's Observational Memory system.
 * https://mastra.ai/blog/observational-memory
 */

import { ENV } from '../config/index.js'
import type OpenAI from 'openai'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PATHS } from '../config/index.js'
import { logger } from '../core/logger.js'
import { getOpenAI } from '../core/openai.js'
import type { Message, Session } from '../types.js'
import { estimateMessageTokens, estimateMessagesTokensRaw, estimateTokens } from '../helpers/tokens.js'
import { runObserver } from './observer.js'
import { runReflector } from './reflector.js'

const MEMORY_DIR = PATHS.MEMORY_DIR

export interface MemoryConfig {
  observationThresholdTokens: number
  reflectionThresholdTokens: number
  reflectionTargetTokens: number
  observerModel: string
  reflectorModel: string
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  observationThresholdTokens: 30_000,
  reflectionThresholdTokens: 40_000,
  reflectionTargetTokens: 20_000,
  observerModel: ENV.openaiModel,
  reflectorModel: ENV.openaiModel,
}

export interface ProcessedContext {
  systemPrompt: string
  messages: Message[]
}

const CONTINUATION_HINT = [
  '<system-reminder>',
  'Conversation history was compressed into memory observations.',
  'Continue naturally. Do not mention memory mechanics.',
  '</system-reminder>',
].join('\n')

const observerCountersBySession = new Map<string, number>()
const reflectorCountersBySession = new Map<string, number>()

const sanitizeSessionId = (sessionId: string): string =>
  sessionId.replace(/[^a-zA-Z0-9-_]/g, '_')

const nextCounter = (map: Map<string, number>, key: string): number => {
  const current = map.get(key) ?? 0
  const next = current + 1
  map.set(key, next)
  return next
}

const pad = (n: number): string => String(n).padStart(3, '0')

const persistObserverLog = async (
  sessionId: string,
  observations: string,
  tokens: number,
  messagesObserved: number,
  generation: number,
  sealedRange: [number, number],
): Promise<void> => {
  const sequence = nextCounter(observerCountersBySession, sessionId)
  const sessionDir = sanitizeSessionId(sessionId)
  const filename = `observer-${pad(sequence)}.md`
  const path = join(MEMORY_DIR, sessionDir, filename)
  const content = [
    '---',
    'type: observation',
    `session: ${sessionId}`,
    `sequence: ${sequence}`,
    `generation: ${generation}`,
    `tokens: ${tokens}`,
    `messages_observed: ${messagesObserved}`,
    `sealed_range: ${sealedRange[0]}–${sealedRange[1]}`,
    `created: ${new Date().toISOString()}`,
    '---',
    '',
    observations,
    '',
  ].join('\n')

  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
  } catch {
    // Best-effort persistence.
  }
}

const persistReflectorLog = async (
  sessionId: string,
  observations: string,
  tokens: number,
  generation: number,
  compressionLevel: number,
): Promise<void> => {
  const sequence = nextCounter(reflectorCountersBySession, sessionId)
  const sessionDir = sanitizeSessionId(sessionId)
  const filename = `reflector-${pad(sequence)}.md`
  const path = join(MEMORY_DIR, sessionDir, filename)
  const content = [
    '---',
    'type: reflection',
    `session: ${sessionId}`,
    `sequence: ${sequence}`,
    `generation: ${generation}`,
    `tokens: ${tokens}`,
    `compression_level: ${compressionLevel}`,
    `created: ${new Date().toISOString()}`,
    '---',
    '',
    observations,
    '',
  ].join('\n')

  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
  } catch {
    // Best-effort persistence.
  }
}

const buildObservationAppendix = (observations: string): string =>
  [
    'The following observations are your memory of past interactions.',
    '',
    '<observations>',
    observations,
    '</observations>',
    '',
    'IMPORTANT: Reference specific details from these observations when relevant.',
    'When observations conflict, prefer the most recent one.',
  ].join('\n')

const splitByTailBudget = (
  messages: Message[],
  tailBudget: number,
): { head: Message[]; tail: Message[] } => {
  let tailTokens = 0
  let splitIndex = messages.length

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateMessageTokens(messages[index])
    if (tailTokens + tokens > tailBudget && splitIndex < messages.length) break
    tailTokens += tokens
    splitIndex = index
  }

  while (splitIndex > 0 && splitIndex < messages.length) {
    const message = messages[splitIndex]
    if ('role' in message && message.role === 'tool') {
      splitIndex -= 1
      continue
    }
    break
  }

  return { head: messages.slice(0, splitIndex), tail: messages.slice(splitIndex) }
}

const runObservation = async (
  openai: OpenAI,
  session: Session,
  config: MemoryConfig,
): Promise<void> => {
  const { messages, memory } = session
  const unobserved = messages.slice(memory.lastObservedIndex)

  const tailBudget = Math.max(120, Math.floor(config.observationThresholdTokens * 0.3))
  const { head } = splitByTailBudget(unobserved, tailBudget)
  const toObserve = head.length > 0 ? head : unobserved

  const observed = await runObserver(openai, config.observerModel, memory.activeObservations, toObserve)
  if (!observed.observations) return

  const previousIndex = memory.lastObservedIndex
  memory.activeObservations = memory.activeObservations
    ? `${memory.activeObservations.trim()}\n\n${observed.observations.trim()}`
    : observed.observations.trim()
  memory.lastObservedIndex = head.length > 0 ? memory.lastObservedIndex + head.length : messages.length
  memory.observationTokenCount = estimateTokens(memory.activeObservations)

  await persistObserverLog(
    session.id,
    observed.observations,
    estimateTokens(observed.observations),
    toObserve.length,
    memory.generationCount,
    [previousIndex, memory.lastObservedIndex - 1],
  )
}

const runReflection = async (
  openai: OpenAI,
  session: Session,
  config: MemoryConfig,
): Promise<void> => {
  const reflected = await runReflector(
    openai,
    config.reflectorModel,
    session.memory.activeObservations,
    config.reflectionTargetTokens,
  )

  session.memory.activeObservations = reflected.observations
  session.memory.observationTokenCount = reflected.tokenCount
  session.memory.generationCount += 1

  await persistReflectorLog(
    session.id,
    reflected.observations,
    reflected.tokenCount,
    session.memory.generationCount,
    reflected.compressionLevel,
  )
}

export const processMemory = async (
  openai: OpenAI,
  session: Session,
  baseSystemPrompt: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<ProcessedContext> => {
  const { messages, memory } = session
  const unobserved = messages.slice(memory.lastObservedIndex)
  const pendingTokens = estimateMessagesTokensRaw(unobserved)
  const hasObservations = memory.activeObservations.length > 0

  if (pendingTokens < config.observationThresholdTokens) {
    return {
      systemPrompt: hasObservations
        ? `${baseSystemPrompt}\n\n${buildObservationAppendix(memory.activeObservations)}`
        : baseSystemPrompt,
      messages: hasObservations ? unobserved : messages,
    }
  }

  if (memory._observerRanThisRequest) {
    return {
      systemPrompt: hasObservations
        ? `${baseSystemPrompt}\n\n${buildObservationAppendix(memory.activeObservations)}`
        : baseSystemPrompt,
      messages: hasObservations ? unobserved : messages,
    }
  }

  try {
    await runObservation(openai, session, config)
    memory._observerRanThisRequest = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('memory.observer.failed', { error: message, sessionId: session.id })
    return { systemPrompt: baseSystemPrompt, messages }
  }

  if (memory.observationTokenCount > config.reflectionThresholdTokens) {
    try {
      await runReflection(openai, session, config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('memory.reflector.failed', { error: message, sessionId: session.id })
    }
  }

  const remaining = messages.slice(memory.lastObservedIndex)
  const finalMessages: Message[] =
    remaining.length > 0
      ? remaining
      : [{ role: 'user' as const, content: CONTINUATION_HINT }]

  return {
    systemPrompt: `${baseSystemPrompt}\n\n${buildObservationAppendix(memory.activeObservations)}`,
    messages: finalMessages,
  }
}

export const flushMemory = async (
  session: Session,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<void> => {
  const unobserved = session.messages.slice(session.memory.lastObservedIndex)
  if (unobserved.length === 0) return

  try {
    const openai = getOpenAI()
    await runObservation(openai, session, config)
    if (session.memory.observationTokenCount > config.reflectionThresholdTokens) {
      await runReflection(openai, session, config)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('memory.flush.failed', { error: message, sessionId: session.id })
  }
}
