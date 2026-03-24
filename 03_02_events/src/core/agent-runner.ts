import { logger } from './logger.js'
import { getOpenAI } from './openai.js'
import { loadAgentTemplate } from '../helpers/agent-template.js'
import { WORKSPACE_NAV_INSTRUCTIONS } from '../helpers/workspace-nav.js'
import {
  appendAssistantMessage,
  buildResponsesTools,
  createDoneResult,
  createFailedResult,
  createUsageTotals,
  createWaitingHumanResult,
  executeFunctionCalls,
  parseModelOutput,
  prepareTurnRequest,
  resolveFunctionTools,
  updateUsageTotals,
  type OnToolCallFn,
} from '../helpers/agent-response-loop.js'
import type { McpManager } from '../mcp/client.js'
import type { AgentName, AgentRunResult, Session } from '../types.js'

const MAX_TURNS = 16

export interface RunAgentInput {
  agent: AgentName
  session: Session
  message: string
  abortSignal?: AbortSignal
  mcp?: McpManager
  onToolCall?: OnToolCallFn
}

export const createFreshSession = (id: string): Session => ({
  id,
  messages: [],
  memory: {
    activeObservations: '',
    lastObservedIndex: 0,
    observationTokenCount: 0,
    generationCount: 0,
  },
})

export { loadAgentTemplate }

export const runAgent = async (runInput: RunAgentInput): Promise<AgentRunResult> => {
  const openai = getOpenAI()
  const template = await loadAgentTemplate(runInput.agent)

  runInput.session.messages.push({ role: 'user', content: runInput.message })
  runInput.session.memory._observerRanThisRequest = false

  const functionTools = resolveFunctionTools(template.tools)
  const mcpToolDefs = runInput.mcp
    ? (await runInput.mcp.listTools()).filter((t) => template.tools.includes(t.prefixedName))
    : []
  const responsesTools = buildResponsesTools(template.tools, functionTools, mcpToolDefs)
  const usageTotals = createUsageTotals()

  const systemPrompt = `${WORKSPACE_NAV_INSTRUCTIONS}\n\n${template.systemPrompt}`

  logger.info('agent.run.started', { agent: runInput.agent, model: template.model, provider: 'responses' })

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const turnNumber = turn + 1
    const { instructions, responseInput, estimatedSafe } = await prepareTurnRequest(
      openai,
      runInput.session,
      systemPrompt,
    )
    usageTotals.totalEstimatedTokens += estimatedSafe

    const response = await openai.responses.create(
      {
        model: template.model,
        instructions,
        input: responseInput,
        tools: responsesTools.length > 0 ? responsesTools : undefined,
      },
      runInput.abortSignal ? { signal: runInput.abortSignal } : undefined,
    )

    updateUsageTotals(usageTotals, response.usage, estimatedSafe)

    const parsedOutput = parseModelOutput(response.output)
    if (!parsedOutput) {
      return createFailedResult('Model returned no output.', usageTotals, turnNumber)
    }

    appendAssistantMessage(runInput.session, parsedOutput.fullText, parsedOutput.functionCalls)

    if (parsedOutput.functionCalls.length === 0) {
      return createDoneResult(parsedOutput.fullText, usageTotals, turnNumber)
    }

    const toolExecution = await executeFunctionCalls({
      functionCalls: parsedOutput.functionCalls,
      context: {
        agent: runInput.agent,
        session: runInput.session,
        abortSignal: runInput.abortSignal,
        mcp: runInput.mcp,
        onToolCall: runInput.onToolCall,
      },
      openai,
    })

    if (toolExecution.kind === 'waiting-human') {
      return createWaitingHumanResult(toolExecution.waitId, toolExecution.question, usageTotals, turnNumber)
    }
  }

  return createFailedResult(`Exceeded max turns (${MAX_TURNS}).`, usageTotals, MAX_TURNS)
}
