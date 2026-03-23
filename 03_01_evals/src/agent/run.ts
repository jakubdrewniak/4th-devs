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

const agentLoop = async (adapter: Adapter, messages: Message[]): Promise<{ response: string; turns: number; usage: Usage }> => {
  let usage: Usage = { input: 0, output: 0, total: 0 }

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

    const { text, toolCalls, output } = completion.value
    const u = completion.value.usage
    usage = {
      input: usage.input! + (u?.input ?? 0),
      output: usage.output! + (u?.output ?? 0),
      total: usage.total! + (u?.total ?? 0),
    }

    messages.push(...output)

    if (toolCalls.length === 0) {
      return { response: text || 'No response from model', turns, usage }
    }

    for (const toolCall of toolCalls) {
      const toolOutput = await withTool(
        { name: toolCall.name, callId: toolCall.callId, input: toolCall.arguments },
        () => executeTool(toolCall.name, toolCall.arguments),
      )

      messages.push({ type: 'function_call_output', call_id: toolCall.callId, output: toolOutput })
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
