export interface AgentEvent {
  seq: number
  type: string
  time: string
  data: Record<string, unknown>
}

type Listener = (event: AgentEvent) => void | Promise<void>

let _seq = 0
const listeners = new Set<Listener>()
const buffer: AgentEvent[] = []
const MAX_BUFFER = 500

export const emit = (type: string, data: Record<string, unknown> = {}): void => {
  const event: AgentEvent = {
    seq: ++_seq,
    type,
    time: new Date().toISOString(),
    data,
  }

  buffer.push(event)
  if (buffer.length > MAX_BUFFER) buffer.shift()

  for (const listener of listeners) {
    try {
      const result = listener(event)
      if (result instanceof Promise) {
        result.catch(err => console.error('[events] async listener error:', err))
      }
    } catch (err) {
      console.error('[events] listener error:', err)
    }
  }
}

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const replay = (): readonly AgentEvent[] => buffer
