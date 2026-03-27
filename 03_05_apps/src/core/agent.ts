import OpenAI from 'openai'
import { ENV } from '../config.js'
import type { AgentTurnResult, ManagerFocus } from '../types.js'

interface RunAgentTurnOptions {
  listsSummary?: string
}

interface OpenListManagerToolInput {
  focus?: string
}

type KnownToolName = 'open_list_manager'

const parseJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

const parseFocus = (value: unknown): ManagerFocus => {
  if (value === 'todo' || value === 'shopping') return value
  return 'todo'
}

const localFallback = (): string =>
  'Opened todo list manager. Add OPENAI_API_KEY or OPENROUTER_API_KEY for model-based intent routing.'

const openai = ENV.apiKey.trim().length > 0
  ? new OpenAI({ apiKey: ENV.apiKey, baseURL: ENV.baseURL, defaultHeaders: ENV.defaultHeaders })
  : null

const ROUTER_INSTRUCTIONS = [
  'You are a CLI assistant with one optional tool: open_list_manager.',
  'open_list_manager ONLY opens a browser UI — it does NOT add, remove, or modify any items.',
  'You cannot change list data yourself. The user must edit items in the browser UI.',
  'NEVER claim you have added, removed, or changed any item. Only say you opened the UI.',
  'Use open_list_manager for any request to manage, edit, update, or review todo/shopping lists.',
  'If the user asks for todo only, set focus=todo.',
  'If the user asks for shopping only, set focus=shopping.',
  'If both or unclear, set focus=todo.',
  'For unrelated conversation, do not call tools.',
  'Keep responses concise and practical.',
].join('\n')

const openListManagerTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'open_list_manager',
  description: 'Open browser UI to manage todo/shopping lists stored in markdown files.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      focus: {
        type: 'string',
        enum: ['todo', 'shopping'],
        description: 'Preferred section to focus in UI.',
      },
    },
    required: [],
  },
}

const extractToolCall = (
  response: OpenAI.Responses.Response,
): (OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName }) | null =>
  response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName } =>
      item.type === 'function_call' && item.name === 'open_list_manager',
  ) ?? null

const completeToolTurn = async (
  baseResponseId: string,
  callId: string,
  output: string,
): Promise<string> => {
  if (!openai) return ''
  const response = await openai.responses.create({
    model: ENV.model,
    reasoning: { effort: 'high' },
    previous_response_id: baseResponseId,
    input: [{ type: 'function_call_output', call_id: callId, output }],
  })
  return response.output_text?.trim() ?? ''
}

export const runAgentTurn = async (
  userMessage: string,
  options: RunAgentTurnOptions = {},
): Promise<AgentTurnResult> => {
  const prompt = userMessage.trim()
  if (!prompt) {
    return {
      kind: 'chat',
      text: 'Please type a prompt.',
    }
  }

  if (!openai) {
    return {
      kind: 'open_manager',
      focus: 'todo',
      text: localFallback(),
    }
  }

  const response = await openai.responses.create({
    model: ENV.model,
    reasoning: { effort: 'high' },
    instructions: ROUTER_INSTRUCTIONS,
    input: [
      `User message:\n${prompt}`,
      `Current lists summary:\n${options.listsSummary ?? 'No state available.'}`,
    ].join('\n\n'),
    tools: [openListManagerTool],
    parallel_tool_calls: false,
  })

  const toolCall = extractToolCall(response)
  if (!toolCall) {
    const text = response.output_text?.trim()
    return {
      kind: 'chat',
      text: text && text.length > 0
        ? text
        : 'I can open the list manager for todo/shopping updates.',
    }
  }

  const parsed = parseJson<OpenListManagerToolInput>(toolCall.arguments) ?? {}
  const focus = parseFocus(parsed.focus)
  const followup = await completeToolTurn(
    response.id,
    toolCall.call_id,
    JSON.stringify({
      ok: true,
      action: 'browser_opened',
      focus,
      note: 'Browser UI was opened. No items were added or modified. The user will make changes in the UI.',
    }),
  )

  return {
    kind: 'open_manager',
    focus,
    text: followup || `Opening list manager (${focus}).`,
  }
}
