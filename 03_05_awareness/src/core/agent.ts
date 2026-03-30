import { ENV } from '../config.js'
import { logger } from '../logger.js'
import type { McpManager } from '../mcp/client.js'
import type { AgentResponse, Message, Session } from '../types.js'
import { resolveTools, executeTool } from './tools.js'
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

  const wrappedUserMessage = `${buildTemporalMetadata()}\n\n${userMessage}`
  const userInput: Message = { role: 'user', content: wrappedUserMessage }

  session.messages.push(userInput)
  session.turns += 1

  const loopResult = await runResponsesToolLoop({
    model: template.model,
    instructions: template.systemPrompt,
    tools: selectedTools,
    initialInput: [...session.messages],
    maxTurns: ENV.maxTurns,
    reasoning: { effort: 'high' },
    parallelToolCalls: true,
    traceLabel: 'agent',
    onTurnStart: ({ turn, inputItems }) => {
      logger.debug('agent.turn', { turn, inputItems })
    },
    executeTool: (call) => executeTool(call, userMessage, mcp, session),
  })

  if (loopResult.fromModel && loopResult.text.trim().length > 0) {
    session.messages.push({ role: 'assistant', content: loopResult.text, phase: 'final_answer' })
  }

  return {
    text: loopResult.text,
    usedTool: loopResult.usedTool,
  }
}
