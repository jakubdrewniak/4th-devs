import type OpenAI from 'openai'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  COMPACT_AFTER_CHARS,
  COMPACT_AFTER_MESSAGES,
  KEEP_RECENT_MESSAGES,
  MEMORY_DIR,
  MEMORY_MODEL,
  MEMORY_PROMPT,
} from './config.js'
import type { SessionLogger } from './logger.js'

export type TextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type FunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type ConversationItem = TextMessage | FunctionCallItem | FunctionCallOutputItem

export interface Session {
  id: string
  summary: string
  messages: ConversationItem[]
}

export const createSession = (id: string): Session => ({
  id,
  summary: '',
  messages: [],
})

export const addUserMessage = (session: Session, content: string): void => {
  session.messages.push({ role: 'user', content })
}

export const addAssistantMessage = (session: Session, content: string): void => {
  session.messages.push({ role: 'assistant', content })
}

export const addToolCall = (
  session: Session,
  call: { call_id: string; name: string; arguments: string },
): void => {
  session.messages.push({
    type: 'function_call',
    call_id: call.call_id,
    name: call.name,
    arguments: call.arguments,
  })
}

export const addToolResult = (session: Session, callId: string, output: string): void => {
  session.messages.push({
    type: 'function_call_output',
    call_id: callId,
    output,
  })
}

const serializeMessages = (messages: ConversationItem[]): string =>
  messages
    .map((message, index) => {
      if ('role' in message) {
        return `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`
      }

      if (message.type === 'function_call') {
        return `${index + 1}. TOOL CALL ${message.name}: ${message.arguments}`
      }

      return `${index + 1}. TOOL RESULT ${message.call_id}: ${message.output}`
    })
    .join('\n\n')

const persistSummary = async (session: Session): Promise<void> => {
  const path = join(MEMORY_DIR, `${session.id}.md`)
  const content = [
    `# Session ${session.id}`,
    '',
    `Updated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    session.summary || '[empty]',
    '',
  ].join('\n')

  await mkdir(MEMORY_DIR, { recursive: true })
  await writeFile(path, content, 'utf-8')
}

export const buildInstructions = (basePrompt: string, summary: string): string =>
  summary.trim().length > 0
    ? `${basePrompt}\n\nSession summary:\n${summary}`
    : basePrompt

export const maybeCompactMemory = async (
  openai: OpenAI,
  session: Session,
  logger: SessionLogger,
): Promise<void> => {
  const serialized = serializeMessages(session.messages)
  const needsCompaction = session.messages.length > COMPACT_AFTER_MESSAGES || serialized.length > COMPACT_AFTER_CHARS

  if (!needsCompaction) {
    return
  }

  const splitIndex = Math.max(0, session.messages.length - KEEP_RECENT_MESSAGES)
  const olderMessages = session.messages.slice(0, splitIndex)

  if (olderMessages.length === 0) {
    return
  }

  logger.info('memory', `Compacting ${olderMessages.length} older message(s)`)

  try {
    const response = await openai.responses.create({
      model: MEMORY_MODEL,
      instructions: MEMORY_PROMPT,
      input: [
        session.summary ? `Current summary:\n${session.summary}` : 'Current summary:\n[none]',
        `Conversation to fold into the summary:\n${serializeMessages(olderMessages)}`,
      ].join('\n\n'),
      store: false,
    })

    const nextSummary = response.output_text?.trim()
    if (!nextSummary) {
      return
    }

    session.summary = nextSummary
    session.messages = session.messages.slice(splitIndex)

    await persistSummary(session)
    await logger.event('memory.compacted', {
      summarizedMessages: olderMessages.length,
      keptMessages: session.messages.length,
      summaryChars: session.summary.length,
    })
  } catch (error) {
    logger.error('memory', error, 'Compaction failed')
  }
}
