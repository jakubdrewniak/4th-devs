import type { RepositoryDatabase } from '../../domain/database-port'
import {
  createRunDependencyRepository,
  type RunDependencyRecord,
} from '../../domain/runtime/run-dependency-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import {
  createToolExecutionRepository,
  type ToolExecutionRecord,
} from '../../domain/runtime/tool-execution-repository'
import type { DomainError } from '../../shared/errors'
import type { SessionThreadId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { loadThreadRootJobReadModel, type JobReadModel } from './job-read-model'

export type ThreadActivityState =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'approval'
  | 'failed'
  | 'completed'

export interface ThreadActivityReadModel {
  completedAt: string | null
  label: string
  state: ThreadActivityState
  updatedAt: string
}

const threadActivityLabels: Record<ThreadActivityState, string> = {
  approval: 'Approve',
  completed: 'Done',
  failed: 'Failed',
  pending: 'Pending',
  running: 'Running',
  waiting: 'Waiting',
}

const threadActivityPriorities: Record<ThreadActivityState, number> = {
  approval: 0,
  failed: 1,
  waiting: 2,
  running: 3,
  pending: 4,
  completed: 5,
}

const toEpochMs = (value: string | null): number | null => {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

const requiresApprovalForWait = (
  wait: Pick<RunDependencyRecord, 'targetKind' | 'type'>,
  toolExecution: Pick<ToolExecutionRecord, 'domain'>,
): boolean => toolExecution.domain === 'mcp' && wait.type === 'human' && wait.targetKind === 'human_response'

const isCompletedWithinWindow = (
  rootJob: Pick<JobReadModel, 'completedAt' | 'status'>,
  nowIso: string,
  completedWithinMinutes: number,
): boolean => {
  if (rootJob.status !== 'completed' || completedWithinMinutes <= 0 || !rootJob.completedAt) {
    return false
  }

  const completedAtMs = toEpochMs(rootJob.completedAt)
  const nowMs = toEpochMs(nowIso)

  if (completedAtMs === null || nowMs === null) {
    return false
  }

  return completedAtMs >= nowMs - completedWithinMinutes * 60_000
}

const loadCurrentRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  rootJob: Pick<JobReadModel, 'currentRunId'>,
): Result<RunRecord | null, DomainError> => {
  if (!rootJob.currentRunId) {
    return ok(null)
  }

  const runRepository = createRunRepository(db)
  const currentRun = runRepository.getById(scope, rootJob.currentRunId)

  if (!currentRun.ok) {
    if (currentRun.error.type === 'not_found') {
      return ok(null)
    }

    return currentRun
  }

  return ok(currentRun.value)
}

const loadPendingWaits = (
  db: RepositoryDatabase,
  scope: TenantScope,
  currentRun: RunRecord | null,
): Result<RunDependencyRecord[], DomainError> => {
  if (!currentRun) {
    return ok([])
  }

  const runDependencyRepository = createRunDependencyRepository(db)

  return runDependencyRepository.listPendingByRunId(scope, currentRun.id)
}

const resolvePendingWaitState = (
  db: RepositoryDatabase,
  scope: TenantScope,
  pendingWaits: RunDependencyRecord[],
): ThreadActivityState | null => {
  if (pendingWaits.length === 0) {
    return null
  }

  const toolExecutionRepository = createToolExecutionRepository(db)

  for (const wait of pendingWaits) {
    const toolExecution = toolExecutionRepository.getById(scope, wait.callId)

    if (toolExecution.ok && requiresApprovalForWait(wait, toolExecution.value)) {
      return 'approval'
    }
  }

  return 'waiting'
}

const toActivityReadModel = (
  state: ThreadActivityState,
  updatedAt: string,
  completedAt: string | null = null,
): ThreadActivityReadModel => ({
  completedAt,
  label: threadActivityLabels[state],
  state,
  updatedAt,
})

export const compareThreadActivityReadModels = (
  left: ThreadActivityReadModel,
  right: ThreadActivityReadModel,
): number => {
  const priorityDelta = threadActivityPriorities[left.state] - threadActivityPriorities[right.state]

  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return right.updatedAt.localeCompare(left.updatedAt)
}

export const loadThreadActivityReadModel = (
  db: RepositoryDatabase,
  scope: TenantScope,
  threadId: SessionThreadId,
  options: {
    completedWithinMinutes: number
    nowIso: string
  },
): Result<ThreadActivityReadModel | null, DomainError> => {
  const rootJob = loadThreadRootJobReadModel(db, scope, threadId)

  if (!rootJob.ok) {
    return rootJob
  }

  if (!rootJob.value) {
    return ok(null)
  }

  const currentRun = loadCurrentRun(db, scope, rootJob.value)

  if (!currentRun.ok) {
    return currentRun
  }

  const pendingWaits = loadPendingWaits(db, scope, currentRun.value)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  const waitState = resolvePendingWaitState(db, scope, pendingWaits.value)
  const activeUpdatedAt =
    pendingWaits.value.at(-1)?.createdAt ?? currentRun.value?.updatedAt ?? rootJob.value.updatedAt

  if (waitState) {
    return ok(toActivityReadModel(waitState, activeUpdatedAt))
  }

  if (currentRun.value?.status === 'waiting' || rootJob.value.status === 'waiting') {
    return ok(toActivityReadModel('waiting', activeUpdatedAt))
  }

  if (rootJob.value.status === 'queued') {
    return ok(toActivityReadModel('pending', rootJob.value.updatedAt))
  }

  if (
    currentRun.value?.status === 'pending' ||
    currentRun.value?.status === 'running' ||
    currentRun.value?.status === 'cancelling' ||
    rootJob.value.status === 'running'
  ) {
    return ok(toActivityReadModel('running', currentRun.value?.updatedAt ?? rootJob.value.updatedAt))
  }

  if (rootJob.value.status === 'blocked' || currentRun.value?.status === 'failed') {
    return ok(toActivityReadModel('failed', currentRun.value?.updatedAt ?? rootJob.value.updatedAt))
  }

  if (isCompletedWithinWindow(rootJob.value, options.nowIso, options.completedWithinMinutes)) {
    return ok(
      toActivityReadModel(
        'completed',
        rootJob.value.completedAt ?? rootJob.value.updatedAt,
        rootJob.value.completedAt,
      ),
    )
  }

  return ok(null)
}
