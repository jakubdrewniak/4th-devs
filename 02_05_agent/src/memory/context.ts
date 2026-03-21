import type { Message, ProcessedContext, Session, CalibrationState } from '../types.js'
import { isFunctionCallOutput } from '../types.js'
import { estimateMessageTokens } from '../ai/tokens.js'
import { CONTINUATION_HINT, buildObservationAppendix } from './prompts.js'

export const splitByTailBudget = (
  messages: Message[],
  tailBudget: number,
  calibration?: CalibrationState,
): { head: Message[]; tail: Message[] } => {
  let tailTokens = 0
  let splitIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const tokens = estimateMessageTokens(messages[i], calibration)
    if (tailTokens + tokens > tailBudget && splitIndex < messages.length) break
    tailTokens += tokens
    splitIndex = i
  }

  while (splitIndex > 0 && splitIndex < messages.length) {
    if (isFunctionCallOutput(messages[splitIndex])) {
      splitIndex -= 1
    } else {
      break
    }
  }

  return { head: messages.slice(0, splitIndex), tail: messages.slice(splitIndex) }
}

export const buildPassthroughContext = (
  session: Session,
  baseSystemPrompt: string,
): ProcessedContext => {
  const { messages, memory } = session
  const hasObservations = memory.activeObservations.length > 0
  const unobserved = messages.slice(memory.lastObservedIndex)

  return {
    systemPrompt: hasObservations
      ? `${baseSystemPrompt}\n\n${buildObservationAppendix(memory.activeObservations)}`
      : baseSystemPrompt,
    messages: hasObservations ? unobserved : messages,
  }
}

export const buildObservedContext = (
  session: Session,
  baseSystemPrompt: string,
): ProcessedContext => {
  const { messages, memory } = session
  const remaining = messages.slice(memory.lastObservedIndex)
  const contextMessages: Message[] = remaining.length > 0
    ? remaining
    : [{ role: 'user', content: CONTINUATION_HINT }]

  return {
    systemPrompt: `${baseSystemPrompt}\n\n${buildObservationAppendix(memory.activeObservations)}`,
    messages: contextMessages,
  }
}
