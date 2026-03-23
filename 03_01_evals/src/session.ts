import type { Session } from './types.js'

const sessions = new Map<string, Session>()

export const getSession = (sessionId: string): Session => {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  const created: Session = { id: sessionId, messages: [] }
  sessions.set(sessionId, created)
  return created
}

export const listSessions = (): Array<{ id: string; messageCount: number }> =>
  [...sessions.values()].map((s) => ({
    id: s.id,
    messageCount: s.messages.length,
  }))
