import type OpenAI from 'openai'
import { MAX_TURNS, MODEL, REASONING, SYSTEM_PROMPT, openai } from './config.js'
import type { SessionLogger } from './logger.js'
import type { McpHandle } from './mcp.js'
import {
  addAssistantMessage,
  addToolCall,
  addToolResult,
  addUserMessage,
  buildInstructions,
  maybeCompactMemory,
  type Session,
} from './memory.js'

type ResponseMessageItem = {
  type: 'message'
  content: Array<{ type: string; text?: string }>
}

type ResponseFunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type ResponseOutputItem = ResponseMessageItem | ResponseFunctionCallItem

interface RunAgentOptions {
  session: Session
  userMessage: string
  mcp: McpHandle
  logger: SessionLogger
}

const truncate = (value: string, max = 140): string =>
  value.length > max ? `${value.slice(0, max - 1)}...` : value

const getMessageText = (item: ResponseMessageItem): string =>
  item.content
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text ?? '')
    .join('')

const readUsage = (
  response: Awaited<ReturnType<typeof openai.responses.create>>,
): { input?: number; output?: number; total?: number } => {
  const usage = (response as unknown as Record<string, unknown>).usage as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined

  return {
    input: usage?.input_tokens,
    output: usage?.output_tokens,
    total: usage?.total_tokens,
  }
}

const runToolCall = async (
  call: ResponseFunctionCallItem,
  mcp: McpHandle,
  logger: SessionLogger,
): Promise<string> => {
  let args: Record<string, unknown>

  try {
    args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
  } catch {
    return 'Error: invalid JSON arguments'
  }

  logger.info('tool', `${call.name}(${truncate(JSON.stringify(args))})`)
  await logger.event('tool.call', { name: call.name, args })

  try {
    const output = await mcp.callTool(call.name, args)
    await logger.event('tool.result', {
      name: call.name,
      outputPreview: truncate(output, 300),
    })
    return output
  } catch (error) {
    logger.error('tool', error, `${call.name} failed`)
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

export const runAgent = async ({
  session,
  userMessage,
  mcp,
  logger,
}: RunAgentOptions): Promise<string> => {
  addUserMessage(session, userMessage)
  await logger.event('user.message', { chars: userMessage.length })

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    await maybeCompactMemory(openai, session, logger)

    logger.info('agent', `Turn ${turn}`)
    await logger.event('turn.start', {
      turn,
      messageCount: session.messages.length,
      summaryChars: session.summary.length,
    })

    const response = await openai.responses.create({
      model: MODEL,
      instructions: buildInstructions(SYSTEM_PROMPT, session.summary),
      input: session.messages as OpenAI.Responses.ResponseInputItem[],
      tools: mcp.tools.length > 0 ? mcp.tools : undefined,
      parallel_tool_calls: false,
      reasoning: REASONING,
      store: false,
    })

    const usage = readUsage(response)
    logger.info(
      'agent',
      `Tokens in=${usage.input ?? '?'} out=${usage.output ?? '?'} total=${usage.total ?? '?'}`,
    )
    await logger.event('model.response', {
      turn,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.total,
      requestId: (response as { _request_id?: string })._request_id,
    })

    const assistantTexts: string[] = []
    const pendingToolCalls: ResponseFunctionCallItem[] = []

    for (const item of response.output as ResponseOutputItem[]) {
      if (item.type === 'message') {
        const text = getMessageText(item)
        if (!text) {
          continue
        }

        addAssistantMessage(session, text)
        assistantTexts.push(text)
        logger.info('assistant', truncate(text))
        continue
      }

      if (item.type === 'function_call') {
        addToolCall(session, item)
        pendingToolCalls.push(item)
      }
    }

    if (pendingToolCalls.length === 0) {
      const finalText = assistantTexts.join('\n\n') || response.output_text || 'Done.'
      await logger.event('turn.done', { turn, completed: true })
      return finalText
    }

    for (const call of pendingToolCalls) {
      const output = await runToolCall(call, mcp, logger)
      addToolResult(session, call.call_id, output)
    }
  }

  await logger.event('turn.done', { completed: false, reason: 'max_turns' })
  return 'Stopped after reaching the maximum number of turns.'
}
