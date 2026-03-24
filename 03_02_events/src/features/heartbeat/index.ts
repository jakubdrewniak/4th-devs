import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import matter from 'gray-matter'
import { buildCapabilityMap } from '../../autonomy/capability-map.js'
import { createFreshSession, runAgent } from '../../core/agent-runner.js'
import type { OnToolCallFn } from '../../helpers/agent-response-loop.js'
import type { McpManager } from '../../mcp/client.js'
import { ENV, PATHS, parsePositiveInt } from '../../config/index.js'
import { EventStore } from '../../core/events.js'
import { flushMemory } from '../../memory/processor.js'
import {
  allTasksCompleted,
  claimNextTask,
  countTasksByStatus,
  listWaitingHumanTasks,
  markTaskBlocked,
  markTaskCompleted,
  markTaskWaitingHuman,
  reopenTaskWithHumanAnswer,
  reconcileDependencyStates,
} from '../tasks/index.js'
import type { AgentName, AgentRunResult, HeartbeatEvent, Session, TaskRecord } from '../../types.js'
import type { AutonomyContext } from '../../autonomy/types.js'
import type { WorkflowDefinition } from '../../workflows/types.js'

const DEFAULT_AGENT_TIMEOUT_MS = ENV.agentTaskTimeoutMs

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface HeartbeatOptions {
  workflow: WorkflowDefinition
  rounds: number
  delayMs: number
  autoHuman: boolean
  verbose?: boolean
  shutdownSignal?: AbortSignal
  autonomy?: AutonomyContext
  mcp?: McpManager
}

type EmitFn = (event: Omit<HeartbeatEvent, 'at'> & { at?: string }) => Promise<void>

const truncate = (text: string, max = 240): string =>
  text.length > max ? `${text.slice(0, max)}...` : text

const countWords = (text: string): number => {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/u).length
}

const formatDurationMs = (value: number): string => {
  if (!Number.isFinite(value)) return '0ms'
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${(value / 1_000).toFixed(1)}s`
}

const readNumber = (data: Record<string, unknown> | undefined, key: string): number | null => {
  if (!data) return null
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const buildVerboseDataSummary = (data: Record<string, unknown> | undefined): string => {
  if (!data) return ''

  const parts: string[] = []
  const maybePush = (label: string, value: number | null, formatter: (input: number) => string = String): void => {
    if (value == null) return
    parts.push(`${label}=${formatter(value)}`)
  }

  maybePush('exec', readNumber(data, 'exec_ms'), formatDurationMs)
  maybePush('round', readNumber(data, 'round_elapsed_ms'), formatDurationMs)
  maybePush('turns', readNumber(data, 'turns'))
  maybePush('tok', readNumber(data, 'actual_tokens'))
  maybePush('tok_est', readNumber(data, 'estimated_tokens'))
  maybePush('words', readNumber(data, 'completion_words'))
  maybePush('chars', readNumber(data, 'completion_chars'))
  maybePush('out_words', readNumber(data, 'output_words'))
  maybePush('out_chars', readNumber(data, 'output_chars'))
  maybePush('out_lines', readNumber(data, 'output_lines'))
  maybePush('claimed', readNumber(data, 'claimed'))
  maybePush('completed', readNumber(data, 'completed_runs'))
  maybePush('blocked', readNumber(data, 'blocked_runs'))
  maybePush('waiting', readNumber(data, 'waiting_human_runs'))
  maybePush('failed', readNumber(data, 'failed_runs'))
  maybePush('produced_words', readNumber(data, 'produced_words'))
  maybePush('produced_chars', readNumber(data, 'produced_chars'))
  maybePush('open', readNumber(data, 'open'))
  maybePush('in_progress', readNumber(data, 'in-progress'))
  maybePush('blocked_tasks', readNumber(data, 'blocked'))
  maybePush('waiting_tasks', readNumber(data, 'waiting-human'))
  maybePush('done', readNumber(data, 'done'))

  return parts.length > 0 ? ` (${parts.join(' ')})` : ''
}

const isTextLikeOutputPath = (outputPath: string): boolean =>
  /\.(md|txt|json|ya?ml|csv|html|xml)$/iu.test(outputPath)

const collectOutputContentStats = async (task: TaskRecord): Promise<Record<string, number>> => {
  const outputPath = task.frontmatter.output_path?.trim()
  if (!outputPath || !isTextLikeOutputPath(outputPath)) return {}

  const fullPath = join(PATHS.WORKSPACE_DIR, outputPath)
  try {
    const content = await readFile(fullPath, 'utf-8')
    return {
      output_chars: content.length,
      output_words: countWords(content),
      output_lines: content ? content.split(/\r?\n/u).length : 0,
    }
  } catch {
    return {}
  }
}

const buildTaskPrompt = (task: TaskRecord, round: number): string =>
  [
    `You are executing heartbeat round ${round}.`,
    `Task ID: ${task.frontmatter.id}`,
    '',
    'Task frontmatter (JSON):',
    JSON.stringify(task.frontmatter, null, 2),
    '',
    'Task body:',
    task.body || '[empty]',
    '',
    'Execution rules:',
    '- Work only on this task.',
    '- If frontmatter has output_path, write the deliverable there.',
    '- If a real decision is required and human_answer is missing, call request_human.',
    '- Finish with a concise completion note.',
  ].join('\n')

const writeWaitFile = async (
  waitId: string,
  taskId: string,
  question: string,
  answer?: string,
): Promise<void> => {
  await mkdir(PATHS.WAITS_DIR, { recursive: true })
  const path = join(PATHS.WAITS_DIR, `${waitId}.md`)
  const now = new Date().toISOString()

  const content = matter.stringify(
    ['## Question', question, '', '## Answer', answer ?? '[pending]', '',].join('\n'),
    {
      id: waitId,
      task_id: taskId,
      status: answer ? 'resolved' : 'pending',
      updated_at: now,
      ...(answer ? { answered_at: now } : {}),
    },
  )

  await writeFile(path, content, 'utf-8')
}

const chooseAutoHumanAnswer = (question: string): string => {
  const lower = question.toLowerCase()
  if (lower.includes('tone') || lower.includes('style')) {
    return 'Use a clear, executive-friendly tone with concrete implementation details.'
  }
  if (lower.includes('yes') && lower.includes('no')) {
    return 'Yes, proceed with the lower-risk and reversible option.'
  }
  return 'Proceed with the most evidence-backed and reversible option.'
}

const askHuman = async (question: string): Promise<string> => {
  const rl = createInterface({ input, output })
  try {
    const response = await rl.question(`\n[human decision needed]\n${question}\n> `)
    return response.trim() || chooseAutoHumanAnswer(question)
  } finally {
    rl.close()
  }
}

const resolveWaitingHumans = async (
  round: number,
  autoHuman: boolean,
  emit: EmitFn,
): Promise<number> => {
  const waiting = await listWaitingHumanTasks()
  if (waiting.length === 0) return 0

  for (const task of waiting) {
    const question = task.frontmatter.wait_question ?? 'Please provide missing decision.'
    const waitId = task.frontmatter.wait_id ?? `wait-${randomUUID().slice(0, 8)}`
    const answer = autoHuman ? chooseAutoHumanAnswer(question) : await askHuman(question)

    await reopenTaskWithHumanAnswer(task, answer)
    await writeWaitFile(waitId, task.frontmatter.id, question, answer)
    await emit({
      type: 'human.input-provided',
      round,
      agent: task.frontmatter.owner,
      taskId: task.frontmatter.id,
      message: truncate(answer, 180),
      data: { waitId },
    })
  }

  return waiting.length
}

const snapshotSessionMemory = (session: Session) => ({
  sealed: session.memory.lastObservedIndex,
  generation: session.memory.generationCount,
})

const markProjectCompleted = async (): Promise<void> => {
  try {
    const raw = await readFile(PATHS.PROJECT_PATH, 'utf-8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const updated = matter.stringify(parsed.content.trim(), {
      ...data,
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    await writeFile(PATHS.PROJECT_PATH, updated, 'utf-8')
  } catch {
    // Best effort.
  }
}

const maybeCompleteProject = async ({
  workflow,
  round,
  emit,
}: {
  workflow: WorkflowDefinition
  round: number
  emit: EmitFn
}): Promise<boolean> => {
  if (!(await allTasksCompleted())) return false

  await markProjectCompleted()
  await emit({
    type: 'project.completed',
    round,
    message: 'All tasks completed.',
    data: { workflow_id: workflow.id },
  })
  return true
}

const runAgentWithTimeout = async (
  agent: AgentName,
  session: Session,
  message: string,
  timeoutMs: number,
  mcp?: McpManager,
  onToolCall?: OnToolCallFn,
): Promise<AgentRunResult> => {
  const controller = new AbortController()
  let timeoutHandle: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error(`Agent timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      runAgent({
        agent,
        session,
        message,
        abortSignal: controller.signal,
        mcp,
        onToolCall,
      }),
      timeoutPromise,
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

export const runHeartbeatLoop = async (options: HeartbeatOptions): Promise<void> => {
  const workflow = options.workflow
  process.env.WORKFLOW_ID = workflow.id
  const agentOrder = workflow.agentOrder
  const events = new EventStore()
  const sessions = new Map<AgentName, Session>(
    agentOrder.map((agent) => [agent, createFreshSession(`${agent}:session`)]),
  )
  const capabilitiesByAgent = await buildCapabilityMap(agentOrder)
  const autonomyContext = options.autonomy
  const heartbeatId = `hb-${randomUUID().slice(0, 8)}`
  const taskTimeoutMs = parsePositiveInt(process.env.AGENT_TASK_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS)
  const cumulativeTokens = { actual: 0, estimated: 0, toolCalls: 0 }

  const emit: EmitFn = async (event) => {
    const saved = await events.emit(event)
    if (!options.verbose) return

    const refs = [saved.agent ? `agent=${saved.agent}` : '', saved.taskId ? `task=${saved.taskId}` : '']
      .filter(Boolean)
      .join(' ')
    const summary = buildVerboseDataSummary(saved.data)
    console.log(
      `[${saved.at}] [round:${saved.round}] ${saved.type}${refs ? ` ${refs}` : ''} — ${saved.message}${summary}`,
    )
  }

  for (let round = 1; round <= options.rounds; round += 1) {
    if (options.shutdownSignal?.aborted) break

    const runId = `${heartbeatId}:r${round}`
    events.startRound()

    const roundStartedAtMs = Date.now()
    let shouldStop = false
    const roundMetrics = {
      claimed: 0,
      completedRuns: 0,
      blockedRuns: 0,
      waitingHumanRuns: 0,
      failedRuns: 0,
      totalExecMs: 0,
      totalActualTokens: 0,
      producedWords: 0,
      producedChars: 0,
    }
    try {
      await emit({
        type: 'heartbeat.started',
        round,
        message: `Heartbeat round ${round} started.`,
        data: {
          workflow_id: workflow.id,
          heartbeatId,
          runId,
          task_timeout_ms: taskTimeoutMs,
        },
      })

      if (autonomyContext && round === 1) {
        await emit({
          type: 'plan.approved',
          round,
          message: 'Autonomous plan approved for execution.',
          data: {
            goal_id: autonomyContext.goal.id,
            plan_version: autonomyContext.state.plan_version,
          },
        })
      }

      const dependencyChanges = await reconcileDependencyStates()
      for (const change of dependencyChanges) {
        await emit({
          type: change.became === 'blocked' ? 'task.blocked' : 'task.unblocked',
          round,
          agent: change.task.frontmatter.owner,
          taskId: change.task.frontmatter.id,
          message:
            change.became === 'blocked'
              ? `Blocked by dependencies: ${change.pendingDependencies.join(', ')}`
              : 'Dependencies resolved; task reopened.',
          data: { dependencies: change.pendingDependencies },
        })
      }

      await resolveWaitingHumans(round, options.autoHuman, emit)

      let claimedCount = 0

      for (const agent of agentOrder) {
        if (options.shutdownSignal?.aborted) {
          shouldStop = true
          break
        }

        const task = await claimNextTask({
          owner: agent,
          runId,
          capabilities: capabilitiesByAgent.get(agent)?.capabilities,
        })
        if (!task) continue
        claimedCount += 1
        roundMetrics.claimed += 1

        await emit({
          type: 'task.claimed',
          round,
          agent,
          taskId: task.frontmatter.id,
          message: task.frontmatter.title,
        })

        const session = sessions.get(agent)
        if (!session) continue

        const before = snapshotSessionMemory(session)
        const taskStartedAtMs = Date.now()

        const onToolCall: OnToolCallFn = async ({ tool, args }) => {
          cumulativeTokens.toolCalls += 1

          const pathArgs = ['path', 'paths', 'urls', 'url', 'output_path', 'image_path', 'source', 'destination']
            .map((key) => {
              const val = args[key]
              if (typeof val === 'string') return val
              if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string').join(', ')
              return null
            })
            .filter(Boolean)
            .join(' ')

          await emit({
            type: 'tool.call',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: `${tool}${pathArgs ? ` ${pathArgs}` : ''}`,
            data: { tool, ...args },
          })
        }

        let result: AgentRunResult
        try {
          result = await runAgentWithTimeout(agent, session, buildTaskPrompt(task, round), taskTimeoutMs, options.mcp, onToolCall)
        } catch (error) {
          const execMs = Date.now() - taskStartedAtMs
          const timeoutReason = error instanceof Error ? error.message : 'Agent timed out'
          await markTaskBlocked(task, timeoutReason, 0)
          roundMetrics.blockedRuns += 1
          roundMetrics.totalExecMs += execMs
          await emit({
            type: 'task.blocked',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: truncate(timeoutReason, 180),
            data: { timeout_ms: taskTimeoutMs, exec_ms: execMs },
          })
          continue
        }
        const execMs = Date.now() - taskStartedAtMs
        roundMetrics.totalExecMs += execMs
        roundMetrics.totalActualTokens += result.usage.totalActualTokens
        const after = snapshotSessionMemory(session)

        if (after.sealed > before.sealed) {
          await emit({
            type: 'memory.observed',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: `Sealed ${after.sealed - before.sealed} messages.`,
            data: { sealed: after.sealed, previous: before.sealed },
          })
        }

        if (after.generation > before.generation) {
          await emit({
            type: 'memory.reflected',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: `Reflection generation advanced to ${after.generation}.`,
            data: { generation: after.generation },
          })
        }

        if (result.status === 'waiting-human') {
          const waitId = result.waitId ?? `wait-${randomUUID().slice(0, 8)}`
          const question = result.waitQuestion ?? 'Agent requested human input.'
          await markTaskWaitingHuman(task, waitId, question)
          roundMetrics.waitingHumanRuns += 1
          await writeWaitFile(waitId, task.frontmatter.id, question)
          await emit({
            type: 'task.waiting-human',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: truncate(question, 180),
            data: {
              waitId,
              exec_ms: execMs,
              turns: result.usage.turns,
              actual_tokens: result.usage.totalActualTokens,
            },
          })
          continue
        }

        if (result.status === 'failed') {
          await markTaskBlocked(task, result.error ?? 'Agent failed', 0)
          roundMetrics.blockedRuns += 1
          roundMetrics.failedRuns += 1
          await emit({
            type: 'task.blocked',
            round,
            agent,
            taskId: task.frontmatter.id,
            message: truncate(result.error ?? 'Agent failed', 180),
            data: {
              exec_ms: execMs,
              turns: result.usage.turns,
              actual_tokens: result.usage.totalActualTokens,
            },
          })
          continue
        }

        const completionChars = result.response.length
        const completionWords = countWords(result.response)
        await markTaskCompleted(task, truncate(result.response, 500))
        const outputStats = await collectOutputContentStats(task)
        const producedWords =
          typeof outputStats.output_words === 'number' ? outputStats.output_words : completionWords
        const producedChars =
          typeof outputStats.output_chars === 'number' ? outputStats.output_chars : completionChars
        roundMetrics.completedRuns += 1
        roundMetrics.producedChars += producedChars
        roundMetrics.producedWords += producedWords
        await emit({
          type: 'task.completed',
          round,
          agent,
          taskId: task.frontmatter.id,
          message: truncate(result.response || 'Task completed.', 180),
          data: {
            exec_ms: execMs,
            turns: result.usage.turns,
            estimated_tokens: result.usage.totalEstimatedTokens,
            actual_tokens: result.usage.totalActualTokens,
            completion_words: completionWords,
            completion_chars: completionChars,
            ...outputStats,
          },
        })
      }

      if (claimedCount === 0) {
        const statusCounts = await countTasksByStatus()
        await emit({
          type: 'heartbeat.idle',
          round,
          message: 'No claimable tasks this round.',
          data: statusCounts,
        })
      }

      if (await allTasksCompleted()) {
        shouldStop = await maybeCompleteProject({
          workflow,
          round,
          emit,
        })
      }

      cumulativeTokens.actual += roundMetrics.totalActualTokens

      await emit({
        type: 'heartbeat.finished',
        round,
        message: `Heartbeat round ${round} finished.`,
        data: {
          ...(await countTasksByStatus()),
          round_elapsed_ms: Date.now() - roundStartedAtMs,
          claimed: roundMetrics.claimed,
          completed_runs: roundMetrics.completedRuns,
          blocked_runs: roundMetrics.blockedRuns,
          waiting_human_runs: roundMetrics.waitingHumanRuns,
          failed_runs: roundMetrics.failedRuns,
          actual_tokens: roundMetrics.totalActualTokens,
          cumulative_tokens: cumulativeTokens.actual,
          cumulative_tool_calls: cumulativeTokens.toolCalls,
          produced_words: roundMetrics.producedWords,
          produced_chars: roundMetrics.producedChars,
        },
      })
    } finally {
      await events.flushRound(round)
    }

    if (shouldStop) break
    await sleep(options.delayMs, options.shutdownSignal)
  }

  await Promise.all([...sessions.values()].map((session) => flushMemory(session)))
}
