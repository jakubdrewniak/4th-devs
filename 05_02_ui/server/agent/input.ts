import type OpenAI from 'openai'
import type { ConversationMessage } from '../../shared/chat'
import type { PendingToolCall } from './types'

export type ResponseInputItem = OpenAI.Responses.ResponseInputItem

export const serializeOutput = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const safeParseObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const assistantEventsToInput = (events: ConversationMessage['events']): ResponseInputItem[] => {
  const items: ResponseInputItem[] = []
  let bufferedText = ''

  const flushText = () => {
    if (!bufferedText) {
      return
    }

    items.push({
      type: 'message',
      role: 'assistant',
      content: bufferedText,
    })
    bufferedText = ''
  }

  for (const event of events) {
    switch (event.type) {
      case 'text_delta':
        bufferedText += event.textDelta
        break

      case 'tool_call':
        flushText()
        items.push({
          type: 'function_call',
          call_id: event.toolCallId,
          name: event.name,
          arguments: JSON.stringify(event.args),
          status: 'completed',
        })
        break

      case 'tool_result':
        items.push({
          type: 'function_call_output',
          call_id: event.toolCallId,
          output: serializeOutput(event.output),
          status: 'completed',
        })
        break

      default:
        break
    }
  }

  flushText()
  return items
}

export const conversationToInput = (
  messages: ConversationMessage[],
): ResponseInputItem[] =>
  messages.flatMap(message => {
    if (message.role === 'user') {
      const content = message.text?.trim()
      return content
        ? [{
            type: 'message',
            role: 'user',
            content,
          } satisfies ResponseInputItem]
        : []
    }

    return assistantEventsToInput(message.events)
  })

export const stepOutputsToInput = (
  text: string,
  calls: PendingToolCall[],
): ResponseInputItem[] => {
  const items: ResponseInputItem[] = []

  if (text) {
    items.push({
      type: 'message',
      role: 'assistant',
      content: text,
    })
  }

  for (const call of calls) {
    items.push({
      type: 'function_call',
      call_id: call.callId,
      name: call.name,
      arguments: call.argumentsText,
      status: 'completed',
    })
  }

  return items
}
