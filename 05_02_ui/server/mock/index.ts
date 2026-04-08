import type { ConversationMessage, ConversationSnapshot } from '../../shared/chat'
import { SEED_PROMPT_TEMPLATES } from '../data/products'
import { buildScenario, detectScenario } from './scenarios'
import type { BuiltScenario } from './types'

export const createSeedConversation = (historyCount: number): ConversationSnapshot => {
  const normalizedCount = Math.max(24, historyCount)
  const pairCount = Math.ceil(normalizedCount / 2)
  const messages: ConversationMessage[] = []
  const conversationId = 'demo-conversation'
  const conversationStart = Date.now() - pairCount * 5 * 60_000
  let nextSeq = 1

  for (let index = 0; index < pairCount; index += 1) {
    const prompt = SEED_PROMPT_TEMPLATES[index % SEED_PROMPT_TEMPLATES.length]!
    const scenario = detectScenario(prompt, index)
    const userCreatedAt = new Date(conversationStart + index * 5 * 60_000).toISOString()
    const assistantCreatedAt = new Date(conversationStart + index * 5 * 60_000 + 36_000).toISOString()
    const userMessageId = `seed-user-${index}`
    const assistantMessageId = `seed-assistant-${index}`

    messages.push({
      id: userMessageId,
      role: 'user',
      status: 'complete',
      createdAt: userCreatedAt,
      text: prompt,
      events: [],
    })

    const built = buildScenario(
      scenario,
      assistantMessageId,
      nextSeq,
      new Date(assistantCreatedAt).getTime(),
      '.data',
      false,
    )

    nextSeq = built.nextSeq

    messages.push({
      id: assistantMessageId,
      role: 'assistant',
      status: 'complete',
      createdAt: assistantCreatedAt,
      events: built.events,
    })
  }

  return {
    id: conversationId,
    title: 'Agent UI Streaming Demo',
    mode: 'mock',
    historyCount: messages.slice(-normalizedCount).length,
    messages: messages.slice(-normalizedCount),
  }
}

export const createEmptyConversation = (): ConversationSnapshot => ({
  id: 'live-conversation',
  title: 'Live Agent Chat',
  mode: 'live',
  historyCount: 0,
  messages: [],
})

export const nextSequenceForConversation = (conversation: ConversationSnapshot): number =>
  conversation.messages
    .flatMap(message => message.events)
    .reduce((currentMax, event) => Math.max(currentMax, event.seq), 0) + 1

export const createMockStream = (options: {
  assistantMessageId: string
  prompt: string
  startSeq: number
  dataDir: string
}): BuiltScenario => {
  const scenario = detectScenario(options.prompt)
  return buildScenario(
    scenario,
    options.assistantMessageId,
    options.startSeq,
    Date.now(),
    options.dataDir,
    true,
  )
}

export type { BuiltScenario, MockStep, ScenarioName } from './types'
