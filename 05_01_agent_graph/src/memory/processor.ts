/**
 * Memory processor — orchestrates the observer/reflector cycle for one task thread.
 *
 * Called before each actor step. Checks if a task's raw item tail exceeds the
 * observation threshold, runs the observer to seal an older head into
 * observations, and compresses those observations via the reflector when they
 * grow too large.
 *
 * Observations are stored on the Task and injected into that same task's
 * reconstructed prompt by the scheduler's context builder.
 */

import type { Item, MemoryState, TokenUsage } from '../domain.js'
import { emptyUsage, addUsage } from '../domain.js'
import type { Runtime } from '../runtime.js'
import { serializeItems, runObserver, estimateTokens } from './observer.js'
import { runReflector } from './reflector.js'
import { log } from '../log.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export interface MemoryConfig {
  observationThresholdTokens: number
  reflectionThresholdTokens: number
  reflectionTargetTokens: number
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  observationThresholdTokens: 800,
  reflectionThresholdTokens: 1500,
  reflectionTargetTokens: 800,
}

const ACTIVE_TAIL_RATIO = 0.3
const MIN_ACTIVE_TAIL_TOKENS = 120

const freshMemory = (): MemoryState => ({
  observations: '',
  lastObservedSeq: 0,
  observationTokens: 0,
  generation: 0,
})

let observerLogCounter = 0
let reflectorLogCounter = 0
const pad = (n: number): string => String(n).padStart(3, '0')

const estimateItemTokens = (
  item: Item,
  actorNames: Map<string, string>,
): number => estimateTokens(serializeItems([item], actorNames))

const splitByTailBudget = (
  items: Item[],
  tailBudget: number,
  actorNames: Map<string, string>,
): { head: Item[]; tail: Item[] } => {
  let tailTokens = 0
  let splitIndex = items.length

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const tokens = estimateItemTokens(items[i], actorNames)
    if (tailTokens + tokens > tailBudget && splitIndex < items.length) break
    tailTokens += tokens
    splitIndex = i
  }

  while (splitIndex > 0 && splitIndex < items.length) {
    const current = items[splitIndex]
    const previous = items[splitIndex - 1]
    if (current?.type === 'result' && previous?.type === 'invocation') {
      splitIndex -= 1
      continue
    }
    break
  }

  return {
    head: items.slice(0, splitIndex),
    tail: items.slice(splitIndex),
  }
}

const persistLog = async (
  dataDir: string,
  type: 'observer' | 'reflector',
  content: string,
  meta: Record<string, unknown>,
): Promise<void> => {
  const counter = type === 'observer' ? ++observerLogCounter : ++reflectorLogCounter
  const filename = `${type}-${pad(counter)}.md`
  const filePath = join(dataDir, 'memory', filename)

  const header = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `---\n${header}\n---\n\n${content}\n`, 'utf-8')
    log.memoryPersisted(filename)
  } catch { /* best-effort */ }
}

/**
 * Run the memory cycle for a task thread.
 *
 * 1. Gather task items since last observation
 * 2. If above token threshold → run observer
 * 3. Merge new observations with the task's existing observations
 * 4. If observations exceed reflection threshold → run reflector
 * 5. Persist updated memory state on the task
 */
export async function processTaskMemory(
  taskId: string,
  rt: Runtime,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<void> {
  const task = await rt.tasks.getById(taskId)
  if (!task) return

  const memory = task.memory ?? freshMemory()

  const newItems = await rt.items.find(
    i => i.task_id === taskId && i.sequence > memory.lastObservedSeq,
  )
  if (newItems.length === 0) return

  const actors = await rt.actors.find(a => a.session_id === task.session_id)
  const actorNames = new Map(actors.map(a => [a.id, a.name]))
  const pendingTokens = estimateTokens(serializeItems(newItems, actorNames))

  log.memoryStatus(newItems.length, pendingTokens, memory.observationTokens, memory.generation)

  if (pendingTokens < config.observationThresholdTokens) {
    log.memorySkipped(pendingTokens, config.observationThresholdTokens)
    return
  }

  // ── Observe ─────────────────────────────────────────────────────────────

  let memoryUsage: TokenUsage = emptyUsage()

  const tailBudget = Math.max(
    MIN_ACTIVE_TAIL_TOKENS,
    Math.floor(config.observationThresholdTokens * ACTIVE_TAIL_RATIO),
  )
  const { head, tail } = splitByTailBudget(newItems, tailBudget, actorNames)
  const itemsToObserve = head.length > 0 ? head : newItems

  const observed = await runObserver(memory.observations, itemsToObserve, actorNames)
  memoryUsage = addUsage(memoryUsage, observed.usage)
  if (!observed.observations) {
    await accumulateMemoryUsage(task.session_id, memoryUsage, rt)
    return
  }

  const sealedFromSeq = itemsToObserve[0]?.sequence
  const sealedThroughSeq = itemsToObserve[itemsToObserve.length - 1]?.sequence
  if (sealedFromSeq === undefined || sealedThroughSeq === undefined) {
    await accumulateMemoryUsage(task.session_id, memoryUsage, rt)
    return
  }

  const merged = memory.observations
    ? `${memory.observations.trim()}\n\n${observed.observations.trim()}`
    : observed.observations.trim()

  const observationLines = observed.observations.split('\n').filter(l => l.trim()).length
  const observedTokens = estimateTokens(observed.observations)

  memory.observations = merged
  memory.lastObservedSeq = sealedThroughSeq
  memory.observationTokens = estimateTokens(merged)

  log.memoryObserved(itemsToObserve.length, observationLines, observedTokens, sealedThroughSeq)

  await persistLog(rt.dataDir, 'observer', observed.observations, {
    session: task.session_id,
    task: taskId,
    generation: memory.generation,
    tokens: observedTokens,
    items_observed: itemsToObserve.length,
    sealed_from_seq: sealedFromSeq,
    sealed_through_seq: sealedThroughSeq,
    active_tail_items: tail.length,
    created: new Date().toISOString(),
  })

  // ── Reflect (only if observations exceed threshold) ─────────────────────

  if (memory.observationTokens > config.reflectionThresholdTokens) {
    const tokensBefore = memory.observationTokens
    try {
      const reflected = await runReflector(memory.observations, config.reflectionTargetTokens)
      memoryUsage = addUsage(memoryUsage, reflected.usage)
      memory.observations = reflected.observations
      memory.observationTokens = reflected.tokenCount
      memory.generation += 1

      log.memoryReflected(tokensBefore, reflected.tokenCount, reflected.compressionLevel, memory.generation)

      await persistLog(rt.dataDir, 'reflector', reflected.observations, {
        session: task.session_id,
        task: taskId,
        generation: memory.generation,
        tokens: reflected.tokenCount,
        compression_level: reflected.compressionLevel,
        created: new Date().toISOString(),
      })
    } catch (err) {
      log.warn(`[memory] reflector failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── Persist ─────────────────────────────────────────────────────────────

  await rt.tasks.update(task.id, { memory })
  await accumulateMemoryUsage(task.session_id, memoryUsage, rt)
}

async function accumulateMemoryUsage(sessionId: string, usage: TokenUsage, rt: Runtime): Promise<void> {
  if (usage.totalTokens === 0) return
  const session = await rt.sessions.getById(sessionId)
  if (!session) return
  await rt.sessions.update(sessionId, {
    usage: addUsage(session.usage ?? emptyUsage(), usage),
  })
}
