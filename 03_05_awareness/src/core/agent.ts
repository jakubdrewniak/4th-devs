import type OpenAI from 'openai'
import { ENV } from '../config.js'
import { logger, ui } from '../logger.js'
import type { McpManager } from '../mcp/client.js'
import type { AgentResponse, Message, Session } from '../types.js'
import { parseJson, runScout } from './scout.js'
import { loadAgentTemplate } from './template.js'
import { runResponsesToolLoop } from './responses-loop.js'

const buildTemporalMetadata = (): string => {
  const now = new Date()
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
  const localTime = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  return [
    '<metadata>',
    `now_iso: ${now.toISOString()}`,
    `weekday: ${weekday}`,
    `local_time: ${localTime}`,
    `timezone: ${timezone}`,
    'recallable: persona, user_identity, user_preferences, important_dates, episodic_memory, factual_memory, procedural_memory',
    'nudge: think before you respond; recall when the topic shifts; connect what you know; speak as yourself',
    '</metadata>',
  ].join('\n')
}

const wrapUserMessageWithMetadata = (userMessage: string): string =>
  `${buildTemporalMetadata()}\n\n${userMessage}`

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

const parseToolArgs = (raw: string): Record<string, unknown> =>
  parseJson<Record<string, unknown>>(raw || '{}') ?? {}

const resolveTools = (templateToolNames: string[]): OpenAI.Responses.Tool[] => {
  const requestedNames = templateToolNames.length > 0 ? templateToolNames : Object.keys(ALL_TOOLS)
  const tools: OpenAI.Responses.Tool[] = []
  for (const name of requestedNames) {
    const tool = ALL_TOOLS[name]
    if (tool) tools.push(tool)
  }
  return tools
}

const executeThink = (rawArgs: string): string => {
  const args = parseToolArgs(rawArgs)
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
  const args = parseToolArgs(rawArgs)
  const goal = typeof args.goal === 'string' && args.goal.trim().length > 0
    ? args.goal.trim()
    : userMessage
  const startNewSession = args.new_session === true

  ui.tool('recall', startNewSession ? `${goal} (new scout session)` : goal)

  const result = await runScout(goal, userMessage, mcp, session.scoutSession, { startNewSession })
  session.scoutSession = result.session
  return result.text
}

export const createSession = (id: string, injectedMessages: Message[]): Session => ({
  id,
  messages: [...injectedMessages],
  turns: 0,
})

export const runAwarenessTurn = async (
  session: Session,
  userMessage: string,
  mcp: McpManager | null,
): Promise<AgentResponse> => {
  const template = await loadAgentTemplate('awareness')
  const selectedTools = resolveTools(template.tools)

  const wrappedUserMessage = wrapUserMessageWithMetadata(userMessage)
  const userInput: Message = { role: 'user', content: wrappedUserMessage }
  const initialInput: string | OpenAI.Responses.ResponseInput = session.lastResponseId
    ? [userInput]
    : [...session.messages, userInput]

  session.messages.push(userInput)
  session.turns += 1

  const loopResult = await runResponsesToolLoop({
    model: template.model,
    instructions: template.systemPrompt,
    tools: selectedTools,
    initialInput,
    previousResponseId: session.lastResponseId,
    maxTurns: ENV.maxTurns,
    reasoning: { effort: 'high' },
    parallelToolCalls: true,
    traceLabel: 'agent',
    onTurnStart: ({ turn, inputItems, hasPreviousResponseId }) => {
      logger.debug('agent.turn', { turn, inputItems, hasPreviousResponseId })
    },
    executeTool: async (call): Promise<string> => {
      switch (call.name) {
        case 'think':
          return executeThink(call.arguments)
        case 'recall':
          return executeRecall(call.arguments, userMessage, mcp, session)
        default:
          return JSON.stringify({ error: `unknown tool: ${call.name}` })
      }
    },
  })

  session.lastResponseId = loopResult.lastResponseId
  if (loopResult.fromModel && loopResult.text.trim().length > 0) {
    session.messages.push({ role: 'assistant', content: loopResult.text, phase: 'final_answer' })
  }

  return {
    text: loopResult.text,
    usedTool: loopResult.usedTool,
  }
}
