import { readFile } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type OpenAI from 'openai'
import { PATHS } from '../config.js'
import { logger } from '../logger.js'
import type { McpManager } from '../mcp/client.js'
import type { McpToolInfo } from '../mcp/types.js'
import type { RecallScoutSession } from '../types.js'
import { runResponsesToolLoop } from './responses-loop.js'
import { loadAgentTemplate } from './template.js'
import { extractLocation, fetchWeather } from './weather.js'

const MAX_SCOUT_TURNS = 8

interface ScoutResult {
  text: string
  session: RecallScoutSession
}

interface ScoutRunOptions {
  startNewSession?: boolean
}

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const persistScoutNote = async (goal: string, text: string): Promise<void> => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(PATHS.notesScoutDir, `scan-${stamp}.md`)
  const lines = [`# Scout ${stamp}`, '', `Goal: ${goal}`, '', text, '']
  await writeFile(path, `${lines.join('\n')}\n`, 'utf-8')
}

const loadWorkspaceIndex = async (): Promise<string> => {
  try {
    return await readFile(PATHS.workspaceIndexPath, 'utf-8')
  } catch {
    return 'No workspace index available.'
  }
}

const mcpToolsToFunctionTools = (tools: McpToolInfo[]): OpenAI.Responses.FunctionTool[] =>
  tools.map((tool) => ({
    type: 'function' as const,
    name: tool.prefixedName,
    description: tool.description ?? `MCP tool: ${tool.originalName}`,
    strict: false,
    parameters: tool.inputSchema as Record<string, unknown> & { type: 'object' },
  }))

const buildWeatherHint = async (userMessage: string, goal: string): Promise<string> => {
  if (!/(weather|temperature|cold|rain|outside|tonight|chilly)/i.test(`${goal} ${userMessage}`)) {
    return ''
  }

  const identityPath = PATHS.identityPath
  try {
    const identityText = await readFile(identityPath, 'utf-8')
    const location = extractLocation(identityText)
    if (!location) return ''
    const weather = await fetchWeather(location)
    if (!weather) return ''
    return `\nWeather hint: ${weather.location} — ${weather.summary}, ${weather.temperatureC ?? '?'}°C`
  } catch {
    return ''
  }
}

export const runScout = async (
  goal: string,
  userMessage: string,
  mcp: McpManager | null,
  previousSession?: RecallScoutSession,
  options?: ScoutRunOptions,
): Promise<ScoutResult> => {
  const session: RecallScoutSession = options?.startNewSession === true
    ? { messages: [] }
    : { messages: [...(previousSession?.messages ?? [])] }

  if (!mcp) return { text: 'No MCP connection available for recall.', session }

  const template = await loadAgentTemplate('scout')
  const mcpTools = await mcp.listTools()
  const tools = mcpToolsToFunctionTools(mcpTools)
  const workspaceIndex = await loadWorkspaceIndex()
  const weatherHint = await buildWeatherHint(userMessage, goal)

  const isNewConversation = session.messages.length === 0
  const scoutInput: string = [
    isNewConversation ? `## Workspace Index\n\n${workspaceIndex}` : '',
    `## Goal\n\n${goal}`,
    `## User message\n\n${userMessage}`,
    weatherHint,
  ].filter(Boolean).join('\n\n')

  logger.debug('scout.started', {
    goal,
    startNewSession: options?.startNewSession === true,
    continuing: !isNewConversation,
  })

  session.messages.push({ role: 'user', content: scoutInput })

  const loopResult = await runResponsesToolLoop({
    model: template.model,
    instructions: template.systemPrompt,
    tools,
    initialInput: [...session.messages],
    maxTurns: MAX_SCOUT_TURNS,
    traceLabel: 'scout',
    onTurnStart: ({ turn, inputItems }) => {
      logger.debug('scout.turn', { turn, inputItems })
    },
    executeTool: async (call): Promise<string> => {
      try {
        const args = parseArgs(call.arguments)
        const result = await mcp.callTool(call.name, args)
        logger.debug('scout.tool.ok', { tool: call.name, chars: result.length })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.debug('scout.tool.error', { tool: call.name, error: message })
        return `Error: ${message}`
      }
    },
  })

  if (loopResult.fromModel && loopResult.text.trim().length > 0) {
    session.messages.push({ role: 'assistant', content: loopResult.text })
  }
  const text = loopResult.text.trim().length > 0
    ? loopResult.text
    : 'No relevant context found for this recall goal.'

  logger.debug('scout.done', { textLength: text.length })
  await persistScoutNote(goal, text).catch(() => undefined)
  return { text, session }
}
