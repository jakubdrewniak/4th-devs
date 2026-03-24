import OpenAI from 'openai'
import { PATHS } from '../config/index.js'
import { logger } from '../core/logger.js'
import type { McpManager } from '../mcp/client.js'
import { DEFAULT_MEMORY_CONFIG, processMemory } from '../memory/processor.js'
import { findTool } from '../tools/index.js'
import { estimateMessagesTokens, getCalibration, recordActualUsage } from './tokens.js'
import type { AgentName, AgentRunResult, Message, Session, Tool } from '../types.js'

const truncate = (text: string, max = 120): string =>
  text.length > max ? `${text.slice(0, max)}...` : text

const extractPathArgs = (args: Record<string, unknown>): Record<string, string> => {
  const paths: Record<string, string> = {}
  for (const key of ['path', 'paths', 'urls', 'url', 'output_path', 'image_path', 'outputDir', 'source', 'destination']) {
    const value = args[key]
    if (typeof value === 'string') paths[key] = value
    else if (Array.isArray(value)) paths[key] = value.filter((v): v is string => typeof v === 'string').join(', ')
  }
  return paths
}

export const BUILTIN_TOOL_NAMES = new Set(['web_search'])

type ResponseTool = OpenAI.Responses.Tool
type ResponseInputItem = OpenAI.Responses.ResponseInputItem
type ResponseOutput = OpenAI.Responses.Response['output']
type ResponseUsage = OpenAI.Responses.Response['usage']

export interface FunctionCall {
  call_id: string
  name: string
  arguments: string
}

interface ParsedResponseOutput {
  fullText: string
  functionCalls: FunctionCall[]
}

export interface UsageTotals {
  totalEstimatedTokens: number
  totalActualTokens: number
}

export type OnToolCallFn = (info: { agent: AgentName; tool: string; args: Record<string, unknown> }) => void | Promise<void>

export interface ToolExecutionContext {
  agent: AgentName
  session: Session
  abortSignal?: AbortSignal
  mcp?: McpManager
  onToolCall?: OnToolCallFn
}

export type ToolExecutionResult =
  | { kind: 'continue' }
  | { kind: 'waiting-human'; waitId: string; question: string }

export const createUsageTotals = (): UsageTotals => ({
  totalEstimatedTokens: 0,
  totalActualTokens: 0,
})

export interface McpToolDefinition {
  prefixedName: string
  description?: string
  inputSchema: Record<string, unknown>
}

export const buildResponsesTools = (
  toolNames: string[],
  functionTools: Tool[],
  mcpTools: McpToolDefinition[] = [],
): ResponseTool[] => {
  const tools: ResponseTool[] = []
  const mcpByName = new Map(mcpTools.map((t) => [t.prefixedName, t]))

  for (const name of toolNames) {
    if (name === 'web_search') {
      tools.push({ type: 'web_search_preview' as const })
      continue
    }

    const mcpTool = mcpByName.get(name)
    if (mcpTool) {
      tools.push({
        type: 'function' as const,
        name: mcpTool.prefixedName,
        description: mcpTool.description ?? '',
        parameters: mcpTool.inputSchema,
        strict: false,
      })
      continue
    }

    const tool = functionTools.find((item) => item.definition.name === name)
    if (!tool) continue

    tools.push({
      type: 'function' as const,
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters as Record<string, unknown>,
      strict: false,
    })
  }

  return tools
}

export const resolveFunctionTools = (toolNames: string[]): Tool[] =>
  toolNames
    .filter((name) => !BUILTIN_TOOL_NAMES.has(name))
    .map((name) => findTool(name))
    .filter((tool): tool is Tool => tool != null)

export const messagesToResponseInput = (
  systemPrompt: string,
  messages: Message[],
): { instructions: string; input: ResponseInputItem[] } => {
  const input: ResponseInputItem[] = []

  for (const message of messages) {
    if (!('role' in message) || message.role === 'system') continue

    switch (message.role) {
      case 'user': {
        const content = typeof message.content === 'string' ? message.content : ''
        if (content) input.push({ role: 'user', content })
        break
      }
      case 'assistant': {
        const textContent = typeof message.content === 'string' ? message.content : ''
        const toolCalls = 'tool_calls' in message ? message.tool_calls ?? [] : []

        if (textContent) {
          input.push({ role: 'assistant', content: textContent })
        }

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') continue
          input.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          })
        }
        break
      }
      case 'tool': {
        const toolMessage = message as { role: 'tool'; tool_call_id: string; content: string }
        input.push({
          type: 'function_call_output',
          call_id: toolMessage.tool_call_id,
          output: toolMessage.content ?? '',
        })
        break
      }
      default:
        break
    }
  }

  return { instructions: systemPrompt, input }
}

const parseToolArguments = (rawArguments?: string): Record<string, unknown> => {
  try {
    return JSON.parse(rawArguments || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

export const prepareTurnRequest = async (
  openai: OpenAI,
  session: Session,
  systemPrompt: string,
): Promise<{ instructions: string; responseInput: ResponseInputItem[]; estimatedSafe: number }> => {
  const context = await processMemory(openai, session, systemPrompt, DEFAULT_MEMORY_CONFIG)
  const callMessages: Message[] = [{ role: 'system', content: context.systemPrompt }, ...context.messages]
  const estimated = estimateMessagesTokens(callMessages)
  const { instructions, input } = messagesToResponseInput(context.systemPrompt, context.messages)

  return {
    instructions,
    responseInput: input,
    estimatedSafe: estimated.safe,
  }
}

export const updateUsageTotals = (
  totals: UsageTotals,
  usage: ResponseUsage,
  estimatedSafe: number,
): void => {
  if (!usage) return
  const actual = usage.input_tokens + usage.output_tokens
  totals.totalActualTokens += actual
  recordActualUsage(estimatedSafe, actual)
}

const parseResponseOutput = (outputItems: ResponseOutput | null | undefined): ParsedResponseOutput | null => {
  if (!outputItems || outputItems.length === 0) return null

  const textParts: string[] = []
  const functionCalls: FunctionCall[] = []

  for (const item of outputItems) {
    if (item.type === 'message') {
      for (const block of item.content) {
        if (block.type === 'output_text') textParts.push(block.text)
      }
      continue
    }

    if (item.type === 'function_call') {
      functionCalls.push({
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      })
    }
  }

  return { fullText: textParts.join('\n').trim(), functionCalls }
}

export const appendAssistantMessage = (
  session: Session,
  fullText: string,
  functionCalls: FunctionCall[],
): void => {
  if (functionCalls.length === 0) {
    session.messages.push({
      role: 'assistant',
      content: fullText || null,
    })
    return
  }

  session.messages.push({
    role: 'assistant',
    content: fullText || null,
    tool_calls: functionCalls.map((functionCall) => ({
      id: functionCall.call_id,
      type: 'function' as const,
      function: { name: functionCall.name, arguments: functionCall.arguments },
    })),
  })
}

const buildUsage = (totals: UsageTotals, turns: number): AgentRunResult['usage'] => ({
  totalEstimatedTokens: totals.totalEstimatedTokens,
  totalActualTokens: totals.totalActualTokens,
  turns,
  calibrationRatio: getCalibration().ratio,
})

export const createDoneResult = (response: string, totals: UsageTotals, turns: number): AgentRunResult => ({
  status: 'done',
  response,
  usage: buildUsage(totals, turns),
})

export const createFailedResult = (
  error: string,
  totals: UsageTotals,
  turns: number,
): AgentRunResult => ({
  status: 'failed',
  response: '',
  error,
  usage: buildUsage(totals, turns),
})

export const createWaitingHumanResult = (
  waitId: string,
  question: string,
  totals: UsageTotals,
  turns: number,
): AgentRunResult => ({
  status: 'waiting-human',
  response: 'Waiting for human decision.',
  waitId,
  waitQuestion: question,
  usage: buildUsage(totals, turns),
})

export const parseModelOutput = (
  output: ResponseOutput | null | undefined,
): ParsedResponseOutput | null => parseResponseOutput(output)

const executeMcpTool = async (
  functionCall: FunctionCall,
  context: ToolExecutionContext,
): Promise<string | null> => {
  if (!context.mcp) return null
  const parsed = context.mcp.parseName(functionCall.name)
  if (!parsed) return null

  try {
    const args = parseToolArguments(functionCall.arguments)
    return await context.mcp.callTool(functionCall.name, args, context.abortSignal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: MCP tool "${functionCall.name}" failed (${message})`
  }
}

export const executeFunctionCalls = async ({
  functionCalls,
  context,
  openai,
}: {
  functionCalls: FunctionCall[]
  context: ToolExecutionContext
  openai: OpenAI
}): Promise<ToolExecutionResult> => {
  for (const functionCall of functionCalls) {
    const parsedArgs = parseToolArguments(functionCall.arguments)
    const pathArgs = extractPathArgs(parsedArgs)

    logger.info('tool.call', {
      agent: context.agent,
      tool: functionCall.name,
      ...pathArgs,
    })

    if (context.onToolCall) {
      await context.onToolCall({ agent: context.agent, tool: functionCall.name, args: parsedArgs })
    }

    const mcpResult = await executeMcpTool(functionCall, context)
    if (mcpResult !== null) {
      context.session.messages.push({
        role: 'tool',
        tool_call_id: functionCall.call_id,
        content: mcpResult,
      })
      continue
    }

    const tool = findTool(functionCall.name)
    if (!tool) {
      context.session.messages.push({
        role: 'tool',
        tool_call_id: functionCall.call_id,
        content: `Error: unknown tool "${functionCall.name}"`,
      })
      continue
    }

    const toolResult = await tool.handler(parsedArgs, {
      agent: context.agent,
      workspacePath: PATHS.WORKSPACE_DIR,
      openai,
      abortSignal: context.abortSignal,
    })

    if (toolResult.kind === 'human_request') {
      context.session.messages.push({
        role: 'tool',
        tool_call_id: functionCall.call_id,
        content: `Human decision requested (${toolResult.waitId}): ${truncate(toolResult.question, 1_000)}`,
      })
      return {
        kind: 'waiting-human',
        waitId: toolResult.waitId,
        question: toolResult.question,
      }
    }

    context.session.messages.push({
      role: 'tool',
      tool_call_id: functionCall.call_id,
      content: toolResult.content,
    })
  }

  return { kind: 'continue' }
}
