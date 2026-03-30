import type OpenAI from 'openai'
import { openai, ENV, AGENT_MAX_TURNS } from '../config.js'
import type { AgentContext, AgentResult, Message } from '../types.js'
import { createTools } from './tools.js'
import { getCapabilityManifestForPrompt } from './capabilities.js'
import { logger } from '../logger.js'

const buildSystemPrompt = (artifactSummary: string): string => [
  'You are a CLI agent that generates and edits interactive HTML artifacts.',
  'You have tools to inspect, create, and edit artifacts displayed in a live browser preview.',
  'When creating, choose minimal capability packs for the request. Include tailwind for utility-first styling.',
  'When editing, inspect the current artifact first with get_artifact so you have exact HTML to match.',
  'For greetings or general questions, respond conversationally without calling tools.',
  'If the request is ambiguous, ask a concise clarifying question.',
  'Keep responses concise.',
  '',
  getCapabilityManifestForPrompt(),
  '',
  artifactSummary,
].join('\n')

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const runAgent = async (
  messages: Message[],
  userMessage: string,
  ctx: AgentContext,
): Promise<AgentResult> => {
  const tools = createTools(ctx)
  const toolsByName = new Map(tools.map((t) => [t.definition.name, t]))
  const toolDefs = tools.map((t) => t.definition) as OpenAI.Responses.FunctionTool[]

  const artifact = ctx.getCurrentArtifact()
  const artifactSummary = artifact
    ? `Current artifact: "${artifact.title}" (id: ${artifact.id}, packs: ${artifact.packs.join(', ')}, ${artifact.html.length} chars)`
    : 'No artifact currently displayed.'

  messages.push({ role: 'user', content: userMessage })

  for (let turn = 0; turn < AGENT_MAX_TURNS; turn += 1) {
    logger.debug('agent.turn', { turn: turn + 1, messages: messages.length })

    const response = await openai.responses.create({
      model: ENV.model,
      reasoning: { effort: ENV.reasoningEffort },
      instructions: buildSystemPrompt(artifactSummary),
      input: messages as OpenAI.Responses.ResponseInputItem[],
      tools: toolDefs,
      store: false,
    })

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
    )

    if (calls.length === 0) {
      const text = response.output_text?.trim() || 'Done.'
      messages.push({ role: 'assistant', content: text })
      logger.info('agent.done', { turns: turn + 1 })
      return { text, turns: turn + 1 }
    }

    for (const call of calls) {
      messages.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments })
      const args = parseArgs(call.arguments)
      const tool = toolsByName.get(call.name)
      logger.debug('agent.tool_call', { name: call.name, args })
      const output = tool ? await tool.handler(args) : `Unknown tool: ${call.name}`
      messages.push({ type: 'function_call_output', call_id: call.call_id, output })
    }
  }

  return { text: 'Reached maximum turns.', turns: AGENT_MAX_TURNS }
}
