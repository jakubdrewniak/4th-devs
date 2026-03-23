import type { Adapter, CompletionParams, Message, OutputItem } from '../../types.js'
import { isTracingActive } from './init.js'
import { startGeneration } from './tracer.js'

const formatInputItem = (item: Message): Record<string, unknown> => {
  if ('role' in item) {
    const content = typeof item.content === 'string'
      ? item.content
      : Array.isArray(item.content)
        ? item.content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : JSON.stringify(p))).join('\n')
        : ''
    return { role: item.role, content }
  }

  if ('type' in item && item.type === 'function_call_output') {
    return { type: 'function_call_output', call_id: item.call_id, output: item.output }
  }

  return item as unknown as Record<string, unknown>
}

const formatInput = (params: CompletionParams): Array<Record<string, unknown>> => {
  const formatted = params.input.map(formatInputItem)

  if (!params.instructions) return formatted

  return [{ role: 'system', content: params.instructions }, ...formatted]
}

const formatOutput = (
  text: string,
  toolCalls: Array<{ callId: string; name: string; arguments: string }>,
): Record<string, unknown> | undefined => {
  if (!text && toolCalls.length === 0) return undefined

  return {
    role: 'assistant',
    ...(text ? { content: text } : {}),
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((tc) => ({
            type: 'function',
            call_id: tc.callId,
            name: tc.name,
            arguments: tc.arguments,
          })),
        }
      : {}),
  }
}

const buildGenerationInput = (
  params: CompletionParams,
  formattedMessages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | { messages: unknown[]; tools: unknown[] } => {
  if (params.tools?.length) {
    return { messages: formattedMessages, tools: params.tools }
  }

  return formattedMessages
}

export const withGenerationTracing = (adapter: Adapter): Adapter => ({
  complete: async (params) => {
    if (!isTracingActive()) {
      return adapter.complete(params)
    }

    const model = params.model ?? 'unknown'
    const formattedMessages = formatInput(params)
    const generation = startGeneration({
      model,
      input: buildGenerationInput(params, formattedMessages),
      metadata: { mode: 'responses', toolCount: params.tools?.length ?? 0 },
    })

    const result = await adapter.complete(params)

    if (!result.ok) {
      generation.error({ code: result.error.code, message: result.error.message })
      return result
    }

    generation.end({
      output: formatOutput(result.value.text, result.value.toolCalls),
      usage: result.value.usage,
    })

    return result
  },
})
