import type OpenAI from 'openai'
import {
  advanceTurn,
  getPromptRefByName,
  recordTraceError,
  setPromptRef,
  withAgent,
  withTool,
} from '../core/tracing/index.js'
import type { Adapter, AgentRunResult, Message, RunAgentParams, Usage } from '../types.js'
import { TOOL_DEFINITIONS, executeTool } from './tools.js'

export const SYSTEM_PROMPT = `\
You are Alice, a concise and practical assistant.
Use tools when they improve correctness.
Never invent tool outputs.`

const MAX_TURNS = 8

const toAssistantMessage = (
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
): OpenAI.ChatCompletionAssistantMessageParam => ({
  role: 'assistant',
  content: text.length > 0 ? text : null,
  ...(toolCalls.length > 0
    ? {
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
    : {}),
})

const mergeUsage = (left: Usage, right?: Usage): Usage => ({
  input: (left.input ?? 0) + (right?.input ?? 0),
  output: (left.output ?? 0) + (right?.output ?? 0),
  total: (left.total ?? 0) + (right?.total ?? 0),
})

const agentLoop = async (adapter: Adapter, messages: Message[]): Promise<{ response: string; turns: number; usage: Usage }> => {
  let usage: Usage = {}

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const turns = advanceTurn()

    const completion = await adapter.complete({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      instructions: SYSTEM_PROMPT,
      input: messages,
      tools: TOOL_DEFINITIONS,
    })

    if (!completion.ok) {
      recordTraceError({ code: completion.error.code, message: completion.error.message })
      throw new Error(`Model call failed: ${completion.error.message}`)
    }

    usage = mergeUsage(usage, completion.value.usage)

    const { text, toolCalls } = completion.value
    messages.push(toAssistantMessage(text, toolCalls))

    if (toolCalls.length === 0) {
      return { response: text || 'No response from model', turns, usage }
    }

    for (const toolCall of toolCalls) {
      const toolOutput = await withTool(
        { name: toolCall.name, callId: toolCall.id, input: toolCall.arguments },
        () => executeTool(toolCall.name, toolCall.arguments),
      )

      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolOutput })
    }
  }

  throw new Error('Exceeded maximum turns before a final assistant answer')
}

export const runAgent = async ({ adapter, logger, session, message }: RunAgentParams): Promise<AgentRunResult> => {
  session.messages.push({ role: 'user', content: message })

  const alicePromptRef = getPromptRefByName('agents/alice')

  return withAgent(
    { name: 'alice', agentId: `alice:${session.id}`, task: message, metadata: { maxTurns: MAX_TURNS } },
    async () => {
      setPromptRef(alicePromptRef)
      return agentLoop(adapter, session.messages)
    },
  )
}
