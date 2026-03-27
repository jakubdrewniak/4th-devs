import { appendFile, readFile } from 'node:fs/promises'
import { PATHS } from '../config.js'
import type { ChatLogEntry, Message } from '../types.js'

const parseLine = (line: string): ChatLogEntry | null => {
  if (!line.trim()) return null
  try {
    const parsed = JSON.parse(line) as ChatLogEntry
    if (!parsed || (parsed.role !== 'user' && parsed.role !== 'assistant')) return null
    if (typeof parsed.content !== 'string') return null
    if (typeof parsed.sessionId !== 'string' || typeof parsed.at !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export const loadRecentHistory = async (limit: number): Promise<ChatLogEntry[]> => {
  const raw = await readFile(PATHS.chatHistoryPath, 'utf-8').catch(() => '')
  if (!raw.trim()) return []

  const entries = raw
    .split('\n')
    .map((line) => parseLine(line))
    .filter((entry): entry is ChatLogEntry => entry != null)

  return entries.slice(Math.max(0, entries.length - limit))
}

export const historyToMessages = (entries: ChatLogEntry[]): Message[] =>
  entries.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }))

export const appendConversationLogs = async (
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> => {
  const at = new Date().toISOString()
  const lines = [
    JSON.stringify({ at, role: 'user', content: userMessage, sessionId } satisfies ChatLogEntry),
    JSON.stringify({ at, role: 'assistant', content: assistantMessage, sessionId } satisfies ChatLogEntry),
  ]
  await appendFile(PATHS.chatHistoryPath, `${lines.join('\n')}\n`, 'utf-8')
}
