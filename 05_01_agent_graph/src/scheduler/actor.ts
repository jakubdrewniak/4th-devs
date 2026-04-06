import { createHash } from 'node:crypto'
import { type TokenUsage, emptyUsage, addUsage } from '../domain.js'
import type { Actor, Task } from '../domain.js'
import type { Runtime } from '../runtime.js'
import { addItem } from '../runtime.js'
import { generateToolStep, type GenerateToolStepInput } from '../ai/index.js'
import { getActorConfig, toolDefinitions, executeToolCall } from '../tools/index.js'
import { getAgentDefinition } from '../agents/index.js'
import { log } from '../log.js'
import type { GraphQueries } from './graph.js'
import { buildTaskPromptPrefix, buildTaskRunInput } from './context.js'
import { processTaskMemory } from '../memory/index.js'
import {
  MAX_LLM_CALL_ATTEMPTS,
  RecoverableActorError,
  computeRetryDelayMs,
  formatError,
  isTransientLlmError,
} from './recovery.js'

const DEFAULT_MAX_ACTOR_STEPS = 8

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

async function generateToolStepWithRetry(
  input: GenerateToolStepInput,
  actorName: string,
  step: number,
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_LLM_CALL_ATTEMPTS; attempt++) {
    try {
      return await generateToolStep(input)
    } catch (error) {
      lastError = error

      if (!isTransientLlmError(error)) {
        throw error
      }

      if (attempt === MAX_LLM_CALL_ATTEMPTS) {
        throw new RecoverableActorError(
          `Transient LLM failure for "${actorName}" on step ${step}: ${formatError(error)}`,
          computeRetryDelayMs(attempt),
        )
      }

      const delayMs = computeRetryDelayMs(attempt)
      log.warn(`[${actorName}] transient LLM failure on step ${step}; retrying in ${delayMs}ms (${formatError(error)})`)
      await sleep(delayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface ActorRunResult {
  status: 'completed' | 'waiting' | 'blocked'
  message: string
  usage: TokenUsage
}

export async function runActorTask(
  task: Task,
  actor: Actor,
  rt: Runtime,
  graph: GraphQueries,
): Promise<ActorRunResult> {
  const actorConfig = getActorConfig(actor)
  const tools = actorConfig.tools.map(t => toolDefinitions[t])

  if (tools.length === 0) {
    return { status: 'blocked', message: `Actor "${actor.name}" has no tools configured`, usage: emptyUsage() }
  }

  const definition = getAgentDefinition(actor.name)
  const maxSteps = definition?.maxSteps ?? DEFAULT_MAX_ACTOR_STEPS
  const out = log.scoped(actor.name)
  let cumulative = emptyUsage()
  const promptPrefix = await buildTaskPromptPrefix(task, actor, rt)
  const promptCacheKey = createHash('sha256')
    .update(`${task.session_id}:${task.id}:${actor.id}`)
    .digest('hex')
    .slice(0, 48)

  for (let step = 1; step <= maxSteps; step++) {
    out.llm(step)

    try {
      await processTaskMemory(task.id, rt)
    } catch (err) {
      log.warn(`[memory] pre-step processing failed: ${formatError(err)}`)
    }

    const input = await buildTaskRunInput(task, rt, graph, promptPrefix)

    const response = await generateToolStepWithRetry({
      instructions: actorConfig.instructions,
      input,
      promptCacheKey,
      tools,
      webSearch: actorConfig.webSearch,
    }, actor.name, step)

    if (response.usage) {
      cumulative = addUsage(cumulative, response.usage)
      out.usage(response.usage.inputTokens, response.usage.outputTokens, response.usage.cachedTokens)
    }

    const text = response.text.trim()
    if (text) {
      out.decision(text)
      await addItem(rt, task.session_id, 'decision', { text, step }, { taskId: task.id, actorId: actor.id })
    }

    if (response.toolCalls.length === 0) {
      if (await graph.hasUnfinishedChildren(task)) {
        return {
          status: 'waiting',
          message: `Waiting for delegated child tasks to finish before continuing "${task.title}"`,
          usage: cumulative,
        }
      }

      return {
        status: text ? 'completed' : 'blocked',
        message: text || `Actor "${actor.name}" produced no output and no tool calls`,
        usage: cumulative,
      }
    }

    let terminalOutcome: { status: 'completed' | 'blocked'; message: string } | undefined

    for (const call of response.toolCalls) {
      out.tool(call.name, call.arguments)

      await addItem(rt, task.session_id, 'invocation', {
        callId: call.callId, tool: call.name, input: call.arguments, step,
      }, { taskId: task.id, actorId: actor.id })

      let outcome: Awaited<ReturnType<typeof executeToolCall>>
      let toolOk = true

      try {
        outcome = await executeToolCall(call, task, actor, rt)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        toolOk = false
        outcome = {
          status: 'continue',
          message: errorMsg,
          output: JSON.stringify({ error: errorMsg }),
        }
      }

      out.toolResult(call.name, toolOk && outcome.status !== 'blocked', outcome.message)

      await addItem(rt, task.session_id, 'result', {
        callId: call.callId, tool: call.name, output: outcome.output, status: outcome.status, step,
      }, { taskId: task.id, actorId: actor.id })

      if (!terminalOutcome && (outcome.status === 'completed' || outcome.status === 'blocked')) {
        terminalOutcome = { status: outcome.status, message: outcome.message }
      }
    }

    if (terminalOutcome) {
      return { status: terminalOutcome.status, message: terminalOutcome.message, usage: cumulative }
    }
  }

  if (await graph.hasUnfinishedChildren(task)) {
    return {
      status: 'waiting',
      message: `Waiting for delegated child tasks to finish before continuing "${task.title}"`,
      usage: cumulative,
    }
  }

  return { status: 'blocked', message: `Actor "${actor.name}" reached the max step limit (${maxSteps})`, usage: cumulative }
}
