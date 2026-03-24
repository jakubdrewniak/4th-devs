import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import matter from 'gray-matter'
import { PATHS } from '../../config/index.js'
import { isPlainMarkdownFilename } from '../../helpers/paths.js'
import type {
  AgentName,
  TaskFrontmatter,
  TaskPriority,
  TaskRecord,
  TaskStatus,
} from '../../types.js'

export const TASKS_DIR = PATHS.TASKS_DIR

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : []

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const asOptionalNumber = (value: unknown): number | undefined => {
  const parsed = asNumber(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : undefined
}

const asOwner = (value: unknown, fallback: AgentName): AgentName =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback

const asOwnerOptional = (value: unknown): AgentName | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const asStatus = (value: unknown): TaskStatus =>
  value === 'open' ||
  value === 'in-progress' ||
  value === 'blocked' ||
  value === 'waiting-human' ||
  value === 'done'
    ? value
    : 'open'

const asPriority = (value: unknown): TaskPriority =>
  value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium'

const normalizeTaskFrontmatter = (
  data: Record<string, unknown>,
  filenameSlug: string,
): TaskFrontmatter => {
  const now = new Date().toISOString()

  return {
    id: asString(data.id, filenameSlug),
    title: asString(data.title, filenameSlug),
    project: asString(data.project, 'unknown-project'),
    owner: asOwner(data.owner, 'unassigned'),
    goal_id: asString(data.goal_id) || undefined,
    plan_version: asOptionalNumber(data.plan_version),
    required_capabilities: asStringArray(data.required_capabilities),
    status: asStatus(data.status),
    priority: asPriority(data.priority),
    depends_on: asStringArray(data.depends_on),
    output_path: asString(data.output_path) || undefined,
    created_by:
      typeof data.created_by === 'string' && data.created_by.trim().length > 0
        ? data.created_by.trim()
        : 'system',
    attempt: asNumber(data.attempt, 0),
    max_attempts: asNumber(data.max_attempts, 3),
    next_attempt_at: asString(data.next_attempt_at) || undefined,
    claimed_by: asOwnerOptional(data.claimed_by),
    claimed_at: asString(data.claimed_at) || undefined,
    run_id: asString(data.run_id) || undefined,
    blocked_reason: asString(data.blocked_reason) || undefined,
    blocked_by: asStringArray(data.blocked_by),
    wait_id: asString(data.wait_id) || undefined,
    wait_question: asString(data.wait_question) || undefined,
    human_answer: asString(data.human_answer) || undefined,
    completion_note: asString(data.completion_note) || undefined,
    created_at: asString(data.created_at, now),
    updated_at: asString(data.updated_at, now),
    completed_at: asString(data.completed_at) || undefined,
  }
}

const compactFrontmatter = (frontmatter: TaskFrontmatter): Record<string, unknown> =>
  Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => value !== undefined))

const serializeTask = (task: TaskRecord): string =>
  matter.stringify(task.body.trimEnd() + '\n', compactFrontmatter(task.frontmatter))

const readTaskFromPath = async (path: string): Promise<TaskRecord> => {
  const raw = await readFile(path, 'utf-8')
  const parsed = matter(raw)
  const slug = basename(path, '.md')
  return {
    path,
    slug,
    frontmatter: normalizeTaskFrontmatter(parsed.data as Record<string, unknown>, slug),
    body: parsed.content.trim(),
  }
}

const writeTask = async (task: TaskRecord): Promise<void> => {
  await mkdir(TASKS_DIR, { recursive: true })
  await writeFile(task.path, serializeTask(task), 'utf-8')
}

export const saveTask = async (task: TaskRecord): Promise<void> => {
  await writeTask(task)
}

export const findTaskById = async (taskId: string): Promise<TaskRecord | null> => {
  const tasks = await listTasks()
  return tasks.find((task) => task.frontmatter.id === taskId) ?? null
}

export interface CreateTaskInput {
  filename: string
  id: string
  title: string
  project: string
  owner: AgentName
  requiredCapabilities?: string[]
  priority: TaskPriority
  dependsOn?: string[]
  outputPath?: string
  body: string
  createdBy?: AgentName | 'system' | 'human'
  maxAttempts?: number
  goalId?: string
  planVersion?: number
}

export const createTask = async (input: CreateTaskInput): Promise<TaskRecord> => {
  const filename = input.filename.trim()
  if (!isPlainMarkdownFilename(filename)) {
    throw new Error(`Task filename must be a plain markdown filename. Received: "${input.filename}"`)
  }

  const now = new Date().toISOString()
  const slug = basename(filename, '.md')
  const path = join(TASKS_DIR, filename)
  const task: TaskRecord = {
    path,
    slug,
    frontmatter: {
      id: input.id,
      title: input.title,
      project: input.project,
      owner: input.owner,
      ...(input.goalId ? { goal_id: input.goalId } : {}),
      ...(input.planVersion != null ? { plan_version: input.planVersion } : {}),
      ...(input.requiredCapabilities && input.requiredCapabilities.length > 0
        ? { required_capabilities: input.requiredCapabilities }
        : {}),
      status: 'open',
      priority: input.priority,
      depends_on: input.dependsOn ?? [],
      output_path: input.outputPath,
      created_by: input.createdBy ?? 'system',
      attempt: 0,
      max_attempts: input.maxAttempts ?? 3,
      created_at: now,
      updated_at: now,
    },
    body: input.body.trim(),
  }

  await writeTask(task)
  return task
}

export const listTasks = async (): Promise<TaskRecord[]> => {
  await mkdir(TASKS_DIR, { recursive: true })
  const files = (await readdir(TASKS_DIR)).filter((file) => file.endsWith('.md'))
  const tasks = await Promise.all(files.map((file) => readTaskFromPath(join(TASKS_DIR, file))))
  return tasks.sort((a, b) => a.slug.localeCompare(b.slug))
}

const hasReachedSchedule = (task: TaskRecord, now: Date): boolean => {
  const nextAttempt = task.frontmatter.next_attempt_at
  if (!nextAttempt) return true
  const nextAttemptDate = new Date(nextAttempt)
  if (Number.isNaN(nextAttemptDate.getTime())) return true
  return nextAttemptDate <= now
}

const pendingDependencies = (
  task: TaskRecord,
  statusByTaskId: Map<string, TaskStatus>,
): string[] =>
  task.frontmatter.depends_on.filter((id) => statusByTaskId.get(id) !== 'done')

const compareTaskPriority = (a: TaskRecord, b: TaskRecord): number => {
  const priorityDelta = PRIORITY_ORDER[a.frontmatter.priority] - PRIORITY_ORDER[b.frontmatter.priority]
  if (priorityDelta !== 0) return priorityDelta
  return a.frontmatter.created_at.localeCompare(b.frontmatter.created_at)
}

export interface ClaimTaskInput {
  owner: AgentName
  runId: string
  capabilities?: string[]
}

export const claimNextTask = async ({
  owner,
  runId,
  capabilities = [],
}: ClaimTaskInput): Promise<TaskRecord | null> => {
  const now = new Date()
  const tasks = await listTasks()
  const statusByTaskId = new Map(tasks.map((task) => [task.frontmatter.id, task.frontmatter.status]))
  const capabilitySet = new Set(capabilities)

  const isTaskEligible = (task: TaskRecord): boolean => {
    const required = task.frontmatter.required_capabilities ?? []
    if (required.length === 0) {
      return task.frontmatter.owner === owner
    }
    return required.every((capability) => capabilitySet.has(capability))
  }

  const compareForOwner = (a: TaskRecord, b: TaskRecord): number => {
    const priority = compareTaskPriority(a, b)
    if (priority !== 0) return priority

    const ownerA = a.frontmatter.owner === owner ? 0 : 1
    const ownerB = b.frontmatter.owner === owner ? 0 : 1
    if (ownerA !== ownerB) return ownerA - ownerB

    return a.slug.localeCompare(b.slug)
  }

  const candidates = tasks
    .filter(isTaskEligible)
    .filter((task) => task.frontmatter.status === 'open')
    .filter((task) => hasReachedSchedule(task, now))
    .filter((task) => pendingDependencies(task, statusByTaskId).length === 0)
    .sort(compareForOwner)

  for (const candidate of candidates) {
    const latest = await readTaskFromPath(candidate.path)
    if (latest.frontmatter.status !== 'open') continue

    latest.frontmatter.status = 'in-progress'
    latest.frontmatter.claimed_by = owner
    latest.frontmatter.claimed_at = now.toISOString()
    latest.frontmatter.run_id = runId
    latest.frontmatter.updated_at = now.toISOString()
    latest.frontmatter.blocked_reason = undefined
    latest.frontmatter.blocked_by = []
    latest.frontmatter.next_attempt_at = undefined

    await writeTask(latest)
    return latest
  }

  return null
}

export interface DependencyReconcileChange {
  task: TaskRecord
  became: 'blocked' | 'unblocked'
  pendingDependencies: string[]
}

export const reconcileDependencyStates = async (): Promise<DependencyReconcileChange[]> => {
  const now = new Date()
  const tasks = await listTasks()
  const statusByTaskId = new Map(tasks.map((task) => [task.frontmatter.id, task.frontmatter.status]))
  const changes: DependencyReconcileChange[] = []

  for (const task of tasks) {
    if (task.frontmatter.status === 'done' || task.frontmatter.status === 'waiting-human') continue

    if (task.frontmatter.status === 'blocked' && task.frontmatter.blocked_reason !== 'dependencies') {
      if (
        task.frontmatter.attempt < task.frontmatter.max_attempts &&
        hasReachedSchedule(task, now)
      ) {
        task.frontmatter.status = 'open'
        task.frontmatter.blocked_reason = undefined
        task.frontmatter.blocked_by = []
        task.frontmatter.claimed_at = undefined
        task.frontmatter.claimed_by = undefined
        task.frontmatter.run_id = undefined
        task.frontmatter.next_attempt_at = undefined
        task.frontmatter.updated_at = now.toISOString()
        await writeTask(task)
        changes.push({ task, became: 'unblocked', pendingDependencies: [] })
      }
      continue
    }

    if (task.frontmatter.depends_on.length === 0) continue

    const pending = pendingDependencies(task, statusByTaskId)

    if (pending.length > 0 && task.frontmatter.status === 'open') {
      task.frontmatter.status = 'blocked'
      task.frontmatter.blocked_reason = 'dependencies'
      task.frontmatter.blocked_by = pending
      task.frontmatter.updated_at = now.toISOString()
      await writeTask(task)
      changes.push({ task, became: 'blocked', pendingDependencies: pending })
      continue
    }

    if (
      pending.length === 0 &&
      task.frontmatter.status === 'blocked' &&
      task.frontmatter.blocked_reason === 'dependencies'
    ) {
      task.frontmatter.status = 'open'
      task.frontmatter.blocked_reason = undefined
      task.frontmatter.blocked_by = []
      task.frontmatter.updated_at = now.toISOString()
      await writeTask(task)
      changes.push({ task, became: 'unblocked', pendingDependencies: [] })
    }
  }

  return changes
}

export const listWaitingHumanTasks = async (): Promise<TaskRecord[]> => {
  const tasks = await listTasks()
  return tasks.filter((task) => task.frontmatter.status === 'waiting-human')
}

export const markTaskCompleted = async (
  task: TaskRecord,
  completionNote: string,
): Promise<TaskRecord> => {
  const now = new Date().toISOString()
  task.frontmatter.status = 'done'
  task.frontmatter.completion_note = completionNote
  task.frontmatter.completed_at = now
  task.frontmatter.updated_at = now
  task.frontmatter.wait_id = undefined
  task.frontmatter.wait_question = undefined
  task.frontmatter.blocked_reason = undefined
  task.frontmatter.blocked_by = []

  await writeTask(task)
  return task
}

export const markTaskWaitingHuman = async (
  task: TaskRecord,
  waitId: string,
  question: string,
): Promise<TaskRecord> => {
  task.frontmatter.status = 'waiting-human'
  task.frontmatter.wait_id = waitId
  task.frontmatter.wait_question = question
  task.frontmatter.updated_at = new Date().toISOString()
  await writeTask(task)
  return task
}

export const markTaskBlocked = async (
  task: TaskRecord,
  reason: string,
  retryAfterMs = 0,
): Promise<TaskRecord> => {
  const now = new Date()
  task.frontmatter.attempt += 1
  task.frontmatter.status = 'blocked'
  task.frontmatter.blocked_reason = reason
  task.frontmatter.updated_at = now.toISOString()
  task.frontmatter.blocked_by = []
  task.frontmatter.claimed_by = undefined
  task.frontmatter.claimed_at = undefined
  task.frontmatter.run_id = undefined

  if (retryAfterMs > 0 && task.frontmatter.attempt < task.frontmatter.max_attempts) {
    task.frontmatter.next_attempt_at = new Date(now.getTime() + retryAfterMs).toISOString()
  } else {
    task.frontmatter.next_attempt_at = undefined
  }

  await writeTask(task)
  return task
}

export const reopenTaskWithHumanAnswer = async (
  task: TaskRecord,
  answer: string,
): Promise<TaskRecord> => {
  const now = new Date().toISOString()
  task.frontmatter.status = 'open'
  task.frontmatter.human_answer = answer
  task.frontmatter.wait_id = undefined
  task.frontmatter.wait_question = undefined
  task.frontmatter.blocked_reason = undefined
  task.frontmatter.blocked_by = []
  task.frontmatter.claimed_at = undefined
  task.frontmatter.claimed_by = undefined
  task.frontmatter.run_id = undefined
  task.frontmatter.updated_at = now

  await writeTask(task)
  return task
}

export const recoverStaleInProgressTasks = async (staleAfterMs: number): Promise<TaskRecord[]> => {
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return []

  const nowMs = Date.now()
  const tasks = await listTasks()
  const recovered: TaskRecord[] = []

  for (const task of tasks) {
    if (task.frontmatter.status !== 'in-progress') continue

    const claimedAt = task.frontmatter.claimed_at ? new Date(task.frontmatter.claimed_at) : null
    const claimedAtMs =
      claimedAt && !Number.isNaN(claimedAt.getTime()) ? claimedAt.getTime() : Number.NEGATIVE_INFINITY

    if (nowMs - claimedAtMs < staleAfterMs) continue

    const latest = await readTaskFromPath(task.path)
    if (latest.frontmatter.status !== 'in-progress') continue

    latest.frontmatter.status = 'open'
    latest.frontmatter.updated_at = new Date().toISOString()
    latest.frontmatter.claimed_at = undefined
    latest.frontmatter.claimed_by = undefined
    latest.frontmatter.run_id = undefined
    latest.frontmatter.next_attempt_at = undefined
    latest.frontmatter.blocked_reason = undefined
    latest.frontmatter.blocked_by = []

    await writeTask(latest)
    recovered.push(latest)
  }

  return recovered
}

export const allTasksCompleted = async (): Promise<boolean> => {
  const tasks = await listTasks()
  return tasks.length > 0 && tasks.every((task) => task.frontmatter.status === 'done')
}

export const countTasksByStatus = async (): Promise<Record<TaskStatus, number>> => {
  const tasks = await listTasks()
  return tasks.reduce<Record<TaskStatus, number>>(
    (acc, task) => {
      acc[task.frontmatter.status] += 1
      return acc
    },
    {
      open: 0,
      'in-progress': 0,
      blocked: 0,
      'waiting-human': 0,
      done: 0,
    },
  )
}
