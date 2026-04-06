import { type TokenUsage, emptyUsage, addUsage } from '../domain.js'
import type { Actor, Task } from '../domain.js'
import type { Runtime } from '../runtime.js'
import { log } from '../log.js'
import { createGraphQueries } from './graph.js'
import { runActorTask } from './actor.js'
import {
  MAX_AUTO_RETRY_ATTEMPTS,
  RecoverableActorError,
  formatError,
} from './recovery.js'

const MAX_ROUNDS = 20

async function processOneTask(
  task: Task,
  rt: Runtime,
): Promise<void> {
  const graph = createGraphQueries(rt)

  await rt.tasks.update(task.id, { status: 'in_progress' })

  const actor = await graph.findAssignedActor(task)
  if (!actor) {
    await rt.tasks.update(task.id, {
      status: 'blocked',
      recovery: {
        autoRetry: false,
        attempts: task.recovery?.attempts ?? 0,
        lastFailureKind: 'runtime_error',
        lastFailureMessage: 'No assigned actor',
        lastFailureAt: new Date().toISOString(),
      },
    })
    log.warn(`No assigned actor for "${task.title}"`)
    return
  }

  log.actor(actor.name, task.title)

  try {
    const result = await runActorTask(task, actor, rt, graph)

    // Accumulate actor usage onto session
    await accumulateSessionUsage(task.session_id, result.usage, rt)

    if (result.status === 'completed') {
      await rt.tasks.update(task.id, { status: 'done', recovery: undefined })
      await graph.unblockParents(task)
      log.taskDone(actor.name, result.message)
      await updateActorStatus(actor, rt)
      return
    }

    const shouldWait =
      result.status === 'waiting'
      || (result.status === 'blocked' && await graph.hasUnfinishedChildren(task))

    if (shouldWait) {
      await rt.tasks.update(task.id, { status: 'waiting', recovery: undefined })
      log.taskWaiting(actor.name, result.message)
      return
    }

    await rt.tasks.update(task.id, {
      status: 'blocked',
      recovery: {
        autoRetry: false,
        attempts: task.recovery?.attempts ?? 0,
        lastFailureKind: 'explicit_block',
        lastFailureMessage: result.message,
        lastFailureAt: new Date().toISOString(),
      },
    })
    log.taskBlocked(actor.name, result.message)
    await updateActorStatus(actor, rt)
  } catch (err) {
    const message = formatError(err)

    if (err instanceof RecoverableActorError) {
      const retry = await scheduleRecoverableRetry(task, message, err.retryAfterMs, rt)
      const retryMessage = retry.scheduled && retry.nextRetryAt
        ? `${message}. Auto-retry ${retry.attempts}/${MAX_AUTO_RETRY_ATTEMPTS} scheduled for ${retry.nextRetryAt}.`
        : `${message}. Auto-retry limit reached after ${retry.attempts} attempts.`

      log.taskBlocked(actor.name, retryMessage)
      return
    }

    await rt.tasks.update(task.id, {
      status: 'blocked',
      recovery: {
        autoRetry: false,
        attempts: task.recovery?.attempts ?? 0,
        lastFailureKind: 'runtime_error',
        lastFailureMessage: message,
        lastFailureAt: new Date().toISOString(),
      },
    })
    log.taskError(actor.name, message)
  }
}

async function updateActorStatus(actor: Actor, rt: Runtime): Promise<void> {
  const ownedTasks = await rt.tasks.find(
    t => t.session_id === actor.session_id && t.owner_actor_id === actor.id,
  )
  const hasActiveWork = ownedTasks.some(
    t => t.status !== 'done' && t.status !== 'blocked',
  )
  const next = hasActiveWork ? 'active' : 'idle'
  if (actor.status !== next) {
    await rt.actors.update(actor.id, { status: next })
  }
}

async function accumulateSessionUsage(sessionId: string, usage: TokenUsage, rt: Runtime): Promise<void> {
  const session = await rt.sessions.getById(sessionId)
  if (!session) return
  await rt.sessions.update(sessionId, {
    usage: addUsage(session.usage ?? emptyUsage(), usage),
  })
}

async function scheduleRecoverableRetry(
  task: Task,
  message: string,
  retryAfterMs: number,
  rt: Runtime,
): Promise<{ scheduled: boolean; attempts: number; nextRetryAt?: string }> {
  const attempts = (task.recovery?.attempts ?? 0) + 1
  const scheduled = attempts <= MAX_AUTO_RETRY_ATTEMPTS
  const nextRetryAt = scheduled
    ? new Date(Date.now() + retryAfterMs).toISOString()
    : undefined

  await rt.tasks.update(task.id, {
    status: 'blocked',
    recovery: {
      autoRetry: scheduled,
      attempts,
      lastFailureKind: 'llm_transient',
      lastFailureMessage: message,
      lastFailureAt: new Date().toISOString(),
      nextRetryAt,
    },
  })

  return { scheduled, attempts, nextRetryAt }
}

async function recoverStaleTasks(sessionId: string, rt: Runtime): Promise<number> {
  const stale = await rt.tasks.find(
    t => t.session_id === sessionId && t.status === 'in_progress',
  )
  for (const task of stale) {
    await rt.tasks.update(task.id, { status: 'todo' })
    log.warn(`Recovered stale task "${task.title}" (in_progress → todo)`)
  }
  return stale.length
}

export async function processSession(sessionId: string, rt: Runtime): Promise<void> {
  const graph = createGraphQueries(rt)
  let round = 0

  await recoverStaleTasks(sessionId, rt)

  while (round < MAX_ROUNDS) {
    round++
    const ready = await graph.findReadyTasks(sessionId)
    if (ready.length === 0) break

    log.round(round, ready.length)

    for (const task of ready) {
      try {
        await processOneTask(task, rt)
      } catch (err) {
        log.taskError('?', err instanceof Error ? err.message : String(err))
      }
    }
  }
}
