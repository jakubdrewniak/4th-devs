import type OpenAI from 'openai'
import { ui } from '../logger.js'
import type { McpManager } from '../mcp/client.js'
import type { Session } from '../types.js'
import { runScout } from './scout.js'

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const thinkTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'think',
  description:
    'Pause and ask yourself what you might be missing. Explore: what assumptions am I about to make? What would change my response if I knew it? Is there something in memory I haven\'t looked for that this moment calls for? Use this to stay curious, not just efficient.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Questions you\'re genuinely asking yourself — what you don\'t know, what you\'re assuming, what you\'re curious about, what might be worth recalling.',
      },
    },
    required: ['questions'],
  },
}

const recallTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'recall',
  description:
    'Recover context from memory that would change how you respond right now. Write goals as questions about what you need to know, not lists of file categories to load. The scout will find the right sources. Keep each recall focused on one need. The scout session persists, so later recalls build on what was already found.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'A question about what you need to know and why. Frame it as a question, not a category list. Example: "Who is this person and what is my voice with them?" not "load persona, identity, preferences."',
      },
      new_session: {
        type: 'boolean',
        description: 'Set true only when switching to an unrelated domain and you want a fresh scout session. Default false.',
      },
    },
    required: ['goal'],
  },
}

const ALL_TOOLS: Record<string, OpenAI.Responses.FunctionTool> = {
  think: thinkTool,
  recall: recallTool,
}

export const resolveTools = (templateToolNames: string[]): OpenAI.Responses.Tool[] => {
  const requestedNames = templateToolNames.length > 0 ? templateToolNames : Object.keys(ALL_TOOLS)
  const tools: OpenAI.Responses.Tool[] = []
  for (const name of requestedNames) {
    const tool = ALL_TOOLS[name]
    if (tool) tools.push(tool)
  }
  return tools
}

const executeThink = (rawArgs: string): string => {
  const args = parseArgs(rawArgs)
  const questions = Array.isArray(args.questions)
    ? args.questions
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter(Boolean)
    : []

  if (questions.length === 0) return JSON.stringify({ internal_questions: [], next: 'respond directly' })

  ui.tool('think', `${questions.length} questions`)
  for (const [index, question] of questions.entries()) {
    ui.toolDetail(`q${index + 1}: ${question}`)
  }

  return JSON.stringify({
    internal_questions: questions,
    next: 'Now decide: which of these could recall help answer? Which can you answer from what you already know? If any question points to a gap in your memory, recall before responding.',
  })
}

const executeRecall = async (
  rawArgs: string,
  userMessage: string,
  mcp: McpManager | null,
  session: Session,
): Promise<string> => {
  const args = parseArgs(rawArgs)
  const goal = typeof args.goal === 'string' && args.goal.trim().length > 0
    ? args.goal.trim()
    : userMessage
  const startNewSession = args.new_session === true

  ui.tool('recall', startNewSession ? `${goal} (new scout session)` : goal)

  const result = await runScout(goal, userMessage, mcp, session.scoutSession, { startNewSession })
  session.scoutSession = result.session
  return result.text
}

export const executeTool = async (
  call: OpenAI.Responses.ResponseFunctionToolCall,
  userMessage: string,
  mcp: McpManager | null,
  session: Session,
): Promise<string> => {
  switch (call.name) {
    case 'think':
      return executeThink(call.arguments)
    case 'recall':
      return executeRecall(call.arguments, userMessage, mcp, session)
    default:
      return JSON.stringify({ error: `unknown tool: ${call.name}` })
  }
}
