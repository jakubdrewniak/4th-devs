import { randomUUID } from 'node:crypto'
import type OpenAI from 'openai'
import type { StreamEvent } from '../../shared/chat'
import { AI_PROVIDER, DEFAULT_LIVE_MODEL, openAiClient, supportsReasoning } from '../ai/client'
import { executeMockedTool, toolDefinitions } from '../tools'
import { buildEventFactory, findPendingCallById } from './events'
import { conversationToInput, safeParseObject, serializeOutput, stepOutputsToInput } from './input'
import { buildSystemPrompt } from './prompt'
import type { KnownStreamEvent, LiveTurnOptions } from './types'

const DEFAULT_MAX_STEPS = 6
const DEFAULT_MAX_OUTPUT_TOKENS = 4_000
const MIN_MOCK_TOOL_DURATION_MS = 450

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const ensureMinDuration = async (
  startedAt: number,
  minDurationMs: number,
): Promise<void> => {
  const elapsedMs = performance.now() - startedAt
  const remainingMs = minDurationMs - elapsedMs

  if (remainingMs > 0) {
    await sleep(remainingMs)
  }
}

export async function* streamLiveTurn(options: LiveTurnOptions): AsyncGenerator<StreamEvent> {
  const createEvent = buildEventFactory(options.assistantMessageId, options.startSeq)
  const systemPrompt = buildSystemPrompt()
  let input = conversationToInput(options.conversation.messages)

  yield createEvent('assistant_message_start', {
    title: 'Live agent response',
  })

  for (let step = 1; step <= DEFAULT_MAX_STEPS; step += 1) {
    const pendingCalls = new Map<number, { callId: string; name: string; argumentsText: string }>()
    const completedCalls: Array<{ callId: string; name: string; argumentsText: string }> = []
    let bufferedText = ''
    let thinkingOpen = false

    try {
      const request = {
        model: DEFAULT_LIVE_MODEL,
        instructions: systemPrompt,
        input,
        max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        parallel_tool_calls: true,
        store: false,
        stream: true,
        tools: toolDefinitions.map(tool => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: false,
        })),
        ...(supportsReasoning(DEFAULT_LIVE_MODEL)
          ? { reasoning: { effort: 'medium', summary: 'auto' as const } }
          : {}),
      }

      const stream = await openAiClient.responses.create(
        request as Parameters<typeof openAiClient.responses.create>[0],
      ) as AsyncIterable<KnownStreamEvent>

      for await (const rawEvent of stream) {
        const event = rawEvent as { type: string }

        switch (event.type) {
          case 'response.output_item.added': {
            const added = rawEvent as Extract<KnownStreamEvent, { type: 'response.output_item.added' }>

            if (added.item.type === 'function_call') {
              pendingCalls.set(added.output_index, {
                callId: added.item.call_id ?? randomUUID(),
                name: added.item.name ?? 'unknown_tool',
                argumentsText: added.item.arguments ?? '',
              })
            }

            if (added.item.type === 'reasoning' && !thinkingOpen) {
              thinkingOpen = true
              yield createEvent('thinking_start', {
                label: `Thinking (${AI_PROVIDER})`,
              })
            }
            break
          }

          case 'response.reasoning_summary_text.delta': {
            const reasoningDelta = rawEvent as Extract<KnownStreamEvent, { type: 'response.reasoning_summary_text.delta' }>
            if (!thinkingOpen) {
              thinkingOpen = true
              yield createEvent('thinking_start', {
                label: `Thinking (${AI_PROVIDER})`,
              })
            }

            yield createEvent('thinking_delta', {
              textDelta: reasoningDelta.delta,
            })
            break
          }

          case 'response.reasoning_summary_part.done':
            if (thinkingOpen) {
              yield createEvent('thinking_delta', {
                textDelta: '\n\n',
              })
            }
            break

          case 'response.output_text.delta':
          case 'response.refusal.delta': {
            const textDelta = rawEvent as
              | Extract<KnownStreamEvent, { type: 'response.output_text.delta' }>
              | Extract<KnownStreamEvent, { type: 'response.refusal.delta' }>

            if (thinkingOpen) {
              thinkingOpen = false
              yield createEvent('thinking_end', {})
            }

            bufferedText += textDelta.delta
            yield createEvent('text_delta', {
              textDelta: textDelta.delta,
            })
            break
          }

          case 'response.function_call_arguments.delta': {
            const argsDelta = rawEvent as Extract<KnownStreamEvent, { type: 'response.function_call_arguments.delta' }>
            const pending = pendingCalls.get(argsDelta.output_index)
            if (pending) {
              pending.argumentsText += argsDelta.delta
            }
            break
          }

          case 'response.function_call_arguments.done': {
            const argsDone = rawEvent as Extract<KnownStreamEvent, { type: 'response.function_call_arguments.done' }>
            const pending = pendingCalls.get(argsDone.output_index)
            if (pending) {
              pending.argumentsText = argsDone.arguments
            }
            break
          }

          case 'response.output_item.done': {
            const done = rawEvent as Extract<KnownStreamEvent, { type: 'response.output_item.done' }>

            if (done.item.type === 'function_call') {
              const pending = findPendingCallById(pendingCalls, done.item.call_id)
              completedCalls.push({
                callId: done.item.call_id ?? randomUUID(),
                name: done.item.name ?? 'unknown_tool',
                argumentsText: done.item.arguments ?? pending?.argumentsText ?? '{}',
              })
            }

            if (done.item.type === 'reasoning' && thinkingOpen) {
              thinkingOpen = false
              yield createEvent('thinking_end', {})
            }
            break
          }

          case 'response.failed': {
            const failed = rawEvent as Extract<KnownStreamEvent, { type: 'response.failed' }>
            if (thinkingOpen) {
              thinkingOpen = false
              yield createEvent('thinking_end', {})
            }

            yield createEvent('error', {
              message: failed.response.error?.message ?? 'Live response failed.',
            })
            yield createEvent('complete', {
              finishReason: 'error',
            })
            return
          }

          default:
            break
        }
      }

      if (thinkingOpen) {
        yield createEvent('thinking_end', {})
      }

      if (completedCalls.length === 0) {
        yield createEvent('complete', {
          finishReason: 'stop',
        })
        return
      }

      const stepInputItems = stepOutputsToInput(bufferedText, completedCalls)
      const toolOutputItems: OpenAI.Responses.ResponseInputItem[] = []

      for (const call of completedCalls) {
        const args = safeParseObject(call.argumentsText)

        yield createEvent('tool_call', {
          toolCallId: call.callId,
          name: call.name,
          args,
        })

        const startedAt = performance.now()
        try {
          const result = await executeMockedTool(call.name, args, { dataDir: options.dataDir })
          await ensureMinDuration(startedAt, MIN_MOCK_TOOL_DURATION_MS)

          yield createEvent('tool_result', {
            toolCallId: call.callId,
            ok: true,
            output: result.output,
          })

          for (const artifact of result.artifacts ?? []) {
            yield createEvent('artifact', {
              artifactId: `${call.callId}:${artifact.path}`,
              kind: artifact.kind,
              title: artifact.title,
              description: artifact.description,
              path: artifact.path,
              preview: artifact.preview,
            })
          }

          toolOutputItems.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: serializeOutput(result.output),
            status: 'completed',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed.'
          await ensureMinDuration(startedAt, MIN_MOCK_TOOL_DURATION_MS)

          yield createEvent('tool_result', {
            toolCallId: call.callId,
            ok: false,
            output: { error: message },
          })

          toolOutputItems.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: serializeOutput({ error: message }),
            status: 'completed',
          })
        }
      }

      input = [...input, ...stepInputItems, ...toolOutputItems]
    } catch (error) {
      yield createEvent('error', {
        message: error instanceof Error ? error.message : 'Live response failed.',
      })
      yield createEvent('complete', {
        finishReason: 'error',
      })
      return
    }
  }

  yield createEvent('error', {
    message: `The live agent hit the step limit (${DEFAULT_MAX_STEPS}).`,
  })
  yield createEvent('complete', {
    finishReason: 'error',
  })
}
