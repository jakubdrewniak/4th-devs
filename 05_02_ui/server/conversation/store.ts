import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import type { ConversationMessage, ConversationSnapshot, StreamEvent, StreamMode } from '../../shared/chat'
import { createEmptyConversation, createSeedConversation, nextSequenceForConversation } from '../mock'

const DEFAULT_HISTORY_COUNT = 480

const buildConversation = (mode: StreamMode, historyCount: number): ConversationSnapshot =>
  mode === 'live'
    ? createEmptyConversation()
    : createSeedConversation(historyCount)

export class ConversationStore {
  #conversation = createSeedConversation(DEFAULT_HISTORY_COUNT)
  #activeStream = false

  get snapshot(): ConversationSnapshot {
    return this.#conversation
  }

  get activeStream(): boolean {
    return this.#activeStream
  }

  parseStreamMode(value: string | null | undefined): StreamMode {
    return value === 'live' ? 'live' : 'mock'
  }

  normalizeHistoryCount(value: number | undefined): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_HISTORY_COUNT
    }

    return Math.max(24, Math.floor(value ?? DEFAULT_HISTORY_COUNT))
  }

  async reset(dataDir: string, historyCount: number, mode: StreamMode): Promise<ConversationSnapshot> {
    await rm(dataDir, { recursive: true, force: true })
    await mkdir(dataDir, { recursive: true })

    this.#conversation = buildConversation(mode, historyCount)
    this.#conversation.historyCount = this.#conversation.messages.length
    return this.#conversation
  }

  ensureMatchesRequest(historyCount: number, mode: StreamMode): void {
    if (this.#activeStream) {
      return
    }

    if (mode === 'live') {
      if (this.#conversation.mode !== 'live') {
        this.#conversation = createEmptyConversation()
      }
      return
    }

    if (this.#conversation.mode === 'mock' && this.#conversation.historyCount === historyCount) {
      return
    }

    this.#conversation = createSeedConversation(historyCount)
    this.#conversation.historyCount = this.#conversation.messages.length
  }

  switchMode(mode: StreamMode): void {
    if (this.#conversation.mode === mode) {
      return
    }

    this.#conversation = buildConversation(mode, DEFAULT_HISTORY_COUNT)
  }

  createTurn(prompt: string, userMessageId?: string): {
    userMessage: ConversationMessage
    assistantMessage: ConversationMessage
    startSeq: number
  } {
    const userMessage: ConversationMessage = {
      id: userMessageId ?? randomUUID(),
      role: 'user',
      status: 'complete',
      createdAt: new Date().toISOString(),
      text: prompt,
      events: [],
    }

    const assistantMessage: ConversationMessage = {
      id: randomUUID(),
      role: 'assistant',
      status: 'streaming',
      createdAt: new Date().toISOString(),
      events: [],
    }

    this.#conversation.messages.push(userMessage, assistantMessage)
    this.#conversation.historyCount = this.#conversation.messages.length

    return {
      userMessage,
      assistantMessage,
      startSeq: nextSequenceForConversation(this.#conversation),
    }
  }

  snapshotWithoutLatestAssistant(): ConversationSnapshot {
    return {
      ...this.#conversation,
      messages: this.#conversation.messages.slice(0, -1),
    }
  }

  appendAssistantEvent(assistantMessage: ConversationMessage, event: StreamEvent): void {
    assistantMessage.events.push(event)

    if (event.type === 'error') {
      assistantMessage.status = 'error'
      return
    }

    if (event.type === 'complete') {
      assistantMessage.status = event.finishReason === 'error' ? 'error' : 'complete'
      return
    }

    assistantMessage.status = 'streaming'
  }

  createCancelledEvent(messageId: string): StreamEvent {
    return {
      id: randomUUID(),
      type: 'complete',
      messageId,
      seq: nextSequenceForConversation(this.#conversation),
      at: new Date().toISOString(),
      finishReason: 'cancelled',
    }
  }

  startStream(): void {
    this.#activeStream = true
  }

  endStream(): void {
    this.#activeStream = false
  }
}
