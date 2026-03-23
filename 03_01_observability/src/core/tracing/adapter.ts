import type { Adapter, CompletionParams, Message } from '../../types.js'
import { isTracingActive } from './init.js'
import { startGeneration } from './tracer.js'

const formatContent = (content: Message['content'] | null | undefined): string => {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
        return part.text
      }

      return JSON.stringify(part)
    })
    .join('\n')
}

const formatInput = (params: CompletionParams): Array<Record<string, unknown>> => {
  const formatted = params.input.map((message) => {
    if (message.role === 'assistant' && 'tool_calls' in message && Array.isArray(message.tool_calls)) {
      return {
        role: 'assistant',
        content: formatContent(message.content),
        tool_calls: message.tool_calls.flatMap((toolCall) => {
          if (toolCall.type !== 'function' || !('function' in toolCall)) {
            return []
          }

          return [{
            type: 'function',
            id: toolCall.id,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          }]
        }),
      }
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: formatContent(message.content),
      }
    }

    return {
      role: message.role,
      content: formatContent(message.content),
    }
  })

  if (!params.instructions) {
    return formatted
  }

  return [{ role: 'system', content: params.instructions }, ...formatted]
}

const buildGenerationInput = (
  params: CompletionParams,
  formattedMessages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | { messages: unknown[]; tools: unknown[]; tool_choice?: unknown } => {
  if (params.tools?.length) {
    return {
      messages: formattedMessages,
      tools: params.tools,
      ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
    }
  }

  return formattedMessages
}

const formatOutput = (
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
): Record<string, unknown> | undefined => {
  if (!text && toolCalls.length === 0) {
    return undefined
  }

  return {
    role: 'assistant',
    ...(text ? { content: text } : {}),
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((toolCall) => ({
            type: 'function',
            id: toolCall.id,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          })),
        }
      : {}),
  }
}

export const withGenerationTracing = (adapter: Adapter): Adapter => {
  return {
    complete: async (params) => {
      if (!isTracingActive()) {
        return adapter.complete(params)
      }

      const model = params.model ?? 'unknown'
      const formattedMessages = formatInput(params)
      const generation = startGeneration({
        model,
        input: buildGenerationInput(params, formattedMessages),
        metadata: {
          mode: 'complete',
          toolCount: params.tools?.length ?? 0,
        },
      })

      const result = await adapter.complete(params)

      if (!result.ok) {
        generation.error({
          code: result.error.code,
          message: result.error.message,
        })
        return result
      }

      generation.end({
        output: formatOutput(result.value.text, result.value.toolCalls),
        usage: result.value.usage,
      })

      return result
    },
  }
}
