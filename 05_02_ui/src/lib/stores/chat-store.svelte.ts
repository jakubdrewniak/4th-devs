import type {
  Block,
  ConversationMessage,
  ConversationSnapshot,
  MessageRole,
  MessageStatus,
  StreamEvent,
  StreamMode,
} from '../../../shared/chat'
import { applyEvent, materializeBlocks } from '../runtime/materialize'
import { consumeSse } from '../services/sse'
import { perfStats, track } from '../utils/perf'

export interface UiMessage {
  id: string
  role: MessageRole
  status: MessageStatus
  createdAt: string
  text: string
  events: StreamEvent[]
  blocks: Block[]
  lastSeq: number
}

interface ChatState {
  conversationId: string | null
  title: string
  mode: StreamMode
  historyCount: number
  isLoading: boolean
  isStreaming: boolean
  error: string | null
  streamPulse: number
  messages: UiMessage[]
}

const eventIdsByMessageId = new Map<string, Set<string>>()
const toolIndexByMessageId = new Map<string, Map<string, number>>()

const toUiMessage = (message: ConversationMessage): UiMessage => {
  const lastSeq = message.events.reduce((currentMax, event) => Math.max(currentMax, event.seq), 0)

  if (message.role === 'assistant') {
    eventIdsByMessageId.set(message.id, new Set(message.events.map(event => event.id)))
  }

  return {
    id: message.id,
    role: message.role,
    status: message.status,
    createdAt: message.createdAt,
    text: message.text ?? '',
    events: message.events,
    blocks: message.role === 'assistant' ? materializeBlocks(message.events) : [],
    lastSeq,
  }
}

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json() as Promise<T>
}

const createChatStore = () => {
  const state: ChatState = $state({
    conversationId: null,
    title: 'Streaming Agent UI',
    mode: 'live',
    historyCount: 180,
    isLoading: false,
    isStreaming: false,
    error: null,
    streamPulse: 0,
    messages: [],
  })

  const replaceConversation = (snapshot: ConversationSnapshot) => {
    eventIdsByMessageId.clear()
    toolIndexByMessageId.clear()

    state.conversationId = snapshot.id
    state.title = snapshot.title
    state.mode = snapshot.mode
    state.historyCount = snapshot.historyCount
    state.isLoading = false
    state.isStreaming = false
    state.error = null
    state.streamPulse = Date.now()
    state.messages = snapshot.messages.map(toUiMessage)
  }

  const ingestEvent = (event: StreamEvent) => {
    let index = state.messages.findIndex(m => m.id === event.messageId)

    if (index === -1) {
      state.messages.push({
        id: event.messageId,
        role: 'assistant',
        status: 'streaming',
        createdAt: event.at,
        text: '',
        events: [],
        blocks: [],
        lastSeq: 0,
      })
      index = state.messages.length - 1
      toolIndexByMessageId.set(event.messageId, new Map())
    }

    const message = state.messages[index]
    const knownIds = eventIdsByMessageId.get(message.id) ?? new Set<string>()

    if (knownIds.has(event.id) || event.seq <= message.lastSeq) {
      return
    }

    knownIds.add(event.id)
    eventIdsByMessageId.set(message.id, knownIds)

    message.events.push(event)
    message.lastSeq = event.seq

    const toolIndex = toolIndexByMessageId.get(message.id) ?? new Map<string, number>()
    toolIndexByMessageId.set(message.id, toolIndex)
    applyEvent(message.blocks, event, toolIndex)

    if (event.type === 'error') {
      message.status = 'error'
    } else if (event.type === 'complete') {
      message.status = event.finishReason === 'error' ? 'error' : 'complete'
    } else {
      message.status = 'streaming'
    }

    state.streamPulse += 1
  }

  return {
    get conversationId() { return state.conversationId },
    get title() { return state.title },
    get mode() { return state.mode },
    get historyCount() { return state.historyCount },
    get isLoading() { return state.isLoading },
    get isStreaming() { return state.isStreaming },
    get error() { return state.error },
    get streamPulse() { return state.streamPulse },
    get messages() { return state.messages },

    async hydrate(historyCount = 180, mode: StreamMode = 'live') {
      state.isLoading = true
      state.error = null

      try {
        const snapshot = await requestJson<ConversationSnapshot>(
          `/api/conversation?history=${historyCount}&mode=${encodeURIComponent(mode)}`,
        )
        replaceConversation(snapshot)
      } catch (error) {
        state.isLoading = false
        state.error = error instanceof Error ? error.message : 'Failed to load conversation'
      }
    },

    async reset(historyCount: number, mode: StreamMode) {
      state.isLoading = true
      state.error = null

      try {
        const snapshot = await requestJson<ConversationSnapshot>('/api/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ historyCount, mode }),
        })
        replaceConversation(snapshot)
      } catch (error) {
        state.isLoading = false
        state.error = error instanceof Error ? error.message : 'Failed to reset conversation'
      }
    },

    async submit(prompt: string, mode: StreamMode) {
      const trimmedPrompt = prompt.trim()
      if (!trimmedPrompt) {
        return
      }

      const userMessageId = crypto.randomUUID()

      state.error = null
      state.isStreaming = true
      state.messages.push({
        id: userMessageId,
        role: 'user',
        status: 'complete',
        createdAt: new Date().toISOString(),
        text: trimmedPrompt,
        events: [],
        blocks: [],
        lastSeq: 0,
      })
      state.streamPulse += 1

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: trimmedPrompt,
            userMessageId,
            mode,
          }),
        })

        // rAF-based batching: buffer events and flush once per animation frame
        // to prevent render thrashing from high-frequency text deltas
        const pending: StreamEvent[] = []
        let rafScheduled = false

        let flushCount = 0
        const flushBatch = () => {
          rafScheduled = false
          const batch = pending.splice(0)
          track('sseFlush', () => {
            for (const event of batch) {
              ingestEvent(event)
            }
          })
          flushCount += 1
          if (flushCount % 20 === 0) {
            console.log(`[perf] after ${flushCount} flushes`)
            console.table(perfStats())
          }
        }

        await consumeSse(response, (event) => {
          pending.push(event)
          if (!rafScheduled) {
            rafScheduled = true
            requestAnimationFrame(flushBatch)
          }
        })

        // Flush remaining events after stream ends (the last rAF may not have fired)
        if (pending.length > 0) {
          flushBatch()
        }

        console.log(`[perf] stream complete — ${flushCount} total flushes`)
        console.table(perfStats())
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'Streaming request failed'
      } finally {
        state.isStreaming = false
        state.streamPulse += 1
      }
    },
  }
}

export const chatStore = createChatStore()
