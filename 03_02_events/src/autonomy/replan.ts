import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { PATHS } from '../config/index.js'
import { logger } from '../core/logger.js'
import { createTask, findTaskById, listTasks, saveTask } from '../features/tasks/index.js'
import { isPlainMarkdownFilename } from '../helpers/paths.js'
import type { HeartbeatEvent, TaskRecord } from '../types.js'
import { writeAutonomyState } from './materialize.js'
import type { CapabilityMap, ReplanDecision, ReplanPatch } from './types.js'
import { generateReplanDecision } from './plan-generate.js'
import type { AutonomyContext, AutonomyState } from './types.js'

type EmitFn = (event: Omit<HeartbeatEvent, 'at'> & { at?: string }) => Promise<void>

interface ReplanTrigger {
  reason: string
  blockedRatio: number
}

const nowIso = (): string => new Date().toISOString()
const lastSkipReasonByGoal = new Map<string, string>()

const emitSkipIfChanged = async ({
  goalId,
  reasonKey,
  emit,
  round,
  message,
  data,
}: {
  goalId: string
  reasonKey: string
  emit: EmitFn
  round: number
  message: string
  data?: Record<string, unknown>
}): Promise<void> => {
  const previous = lastSkipReasonByGoal.get(goalId)
  if (previous === reasonKey) return
  lastSkipReasonByGoal.set(goalId, reasonKey)
  await emit({
    type: 'replan.skipped',
    round,
    message,
    data,
  })
}

const readStateFromDisk = async (): Promise<AutonomyState | null> => {
  try {
    const raw = await readFile(PATHS.PLAN_STATE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AutonomyState>
    if (
      typeof parsed.goal_id !== 'string' ||
      typeof parsed.plan_version !== 'number' ||
      typeof parsed.remaining_replan_budget !== 'number' ||
      typeof parsed.max_new_tasks_per_replan !== 'number' ||
      !Array.isArray(parsed.approval_required_for)
    ) {
      return null
    }
    return {
      goal_id: parsed.goal_id,
      plan_version: parsed.plan_version,
      remaining_replan_budget: parsed.remaining_replan_budget,
      max_new_tasks_per_replan: parsed.max_new_tasks_per_replan,
      approval_required_for: parsed.approval_required_for,
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : nowIso(),
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : nowIso(),
    }
  } catch {
    return null
  }
}

const detectReplanTrigger = (tasks: readonly TaskRecord[]): ReplanTrigger | null => {
  if (tasks.length === 0) return null

  const blocked = tasks.filter((task) => task.frontmatter.status === 'blocked')
  if (blocked.length === 0) return null

  const blockedRatio = blocked.length / tasks.length
  const hasRetries = blocked.some((task) => task.frontmatter.attempt >= 2)

  if (blockedRatio >= 0.35) {
    return {
      reason: `Blocked ratio is ${blocked.length}/${tasks.length} (${Math.round(blockedRatio * 100)}%).`,
      blockedRatio,
    }
  }

  if (hasRetries) {
    return {
      reason: 'At least one blocked task has retried multiple times.',
      blockedRatio,
    }
  }

  return null
}

const patchNeedsManualApproval = (patch: ReplanPatch): boolean => {
  switch (patch.op) {
    case 'add_task':
    case 'split_task':
    case 'cancel_open_task':
      return true
    case 'change_dependencies':
    case 'de_scope_task':
    case 'reassign_owner':
      return false
    default:
      return false
  }
}

const validatePatchSet = async ({
  decision,
  capabilityMap,
  state,
  tasks,
}: {
  decision: ReplanDecision
  capabilityMap: CapabilityMap
  state: AutonomyState
  tasks: readonly TaskRecord[]
}): Promise<string[]> => {
  const errors: string[] = []
  const tasksById = new Map(tasks.map((task) => [task.frontmatter.id, task]))
  const existingTaskIds = new Set(tasksById.keys())
  const existingFilenames = new Set(tasks.map((task) => basename(task.path)))

  const addTaskOps = decision.patches.filter((patch) => patch.op === 'add_task').length
  if (addTaskOps > state.max_new_tasks_per_replan) {
    errors.push(
      `Replan adds ${addTaskOps} tasks but max_new_tasks_per_replan=${state.max_new_tasks_per_replan}.`,
    )
  }

  for (const patch of decision.patches) {
    if (patch.op === 'add_task') {
      const ownerExists = capabilityMap.has(patch.task.owner)
      if (!ownerExists) errors.push(`add_task "${patch.task.id}" uses unknown owner "${patch.task.owner}".`)

      if (existingTaskIds.has(patch.task.id)) {
        errors.push(`add_task id "${patch.task.id}" already exists.`)
      }
      if (!isPlainMarkdownFilename(patch.task.filename)) {
        errors.push(`add_task "${patch.task.id}" has invalid filename "${patch.task.filename}".`)
      }
      if (existingFilenames.has(patch.task.filename)) {
        errors.push(`add_task filename "${patch.task.filename}" already exists.`)
      }
      for (const dependency of patch.task.dependsOn) {
        if (!existingTaskIds.has(dependency)) {
          errors.push(`add_task "${patch.task.id}" depends on unknown task "${dependency}".`)
        }
      }
      for (const capability of patch.task.requiredCapabilities ?? []) {
        const found = [...capabilityMap.values()].some((snapshot) =>
          snapshot.capabilities.includes(capability),
        )
        if (!found) {
          errors.push(`add_task "${patch.task.id}" needs missing capability "${capability}".`)
        }
      }

      existingTaskIds.add(patch.task.id)
      existingFilenames.add(patch.task.filename)
      continue
    }

    if (patch.op === 'split_task') {
      if (!tasksById.has(patch.task_id)) {
        errors.push(`split_task references unknown task "${patch.task_id}".`)
      }
      for (const replacementTask of patch.replacement) {
        if (existingTaskIds.has(replacementTask.id)) {
          errors.push(`split_task replacement id "${replacementTask.id}" already exists.`)
        }
        if (existingFilenames.has(replacementTask.filename)) {
          errors.push(`split_task replacement filename "${replacementTask.filename}" already exists.`)
        }
        if (!isPlainMarkdownFilename(replacementTask.filename)) {
          errors.push(
            `split_task replacement "${replacementTask.id}" has invalid filename "${replacementTask.filename}".`,
          )
        }
        for (const dependency of replacementTask.dependsOn) {
          if (!existingTaskIds.has(dependency)) {
            errors.push(
              `split_task replacement "${replacementTask.id}" depends on unknown task "${dependency}".`,
            )
          }
        }
      }
      continue
    }

    if (patch.op === 'reassign_owner') {
      const task = tasksById.get(patch.task_id)
      if (!task) errors.push(`reassign_owner references unknown task "${patch.task_id}".`)
      if (task?.frontmatter.status === 'done') {
        errors.push(`reassign_owner cannot target completed task "${patch.task_id}".`)
      }
      if (!capabilityMap.has(patch.owner)) {
        errors.push(`reassign_owner target "${patch.owner}" is not an available agent.`)
      }
      continue
    }

    if (patch.op === 'change_dependencies') {
      const task = tasksById.get(patch.task_id)
      if (!task) errors.push(`change_dependencies references unknown task "${patch.task_id}".`)
      if (task?.frontmatter.status === 'done') {
        errors.push(`change_dependencies cannot target completed task "${patch.task_id}".`)
      }
      for (const dependency of patch.dependsOn) {
        if (!existingTaskIds.has(dependency)) {
          errors.push(`change_dependencies references unknown dependency "${dependency}".`)
        }
      }
      if (patch.dependsOn.includes(patch.task_id)) {
        errors.push(`Task "${patch.task_id}" cannot depend on itself.`)
      }
      continue
    }

    if (patch.op === 'de_scope_task' || patch.op === 'cancel_open_task') {
      const task = tasksById.get(patch.task_id)
      if (!task) errors.push(`${patch.op} references unknown task "${patch.task_id}".`)
      if (task?.frontmatter.status === 'done') {
        errors.push(`${patch.op} cannot target completed task "${patch.task_id}".`)
      }
    }
  }

  return errors
}

const applyPatchSet = async ({
  state,
  decision,
  projectId,
  goalId,
}: {
  state: AutonomyState
  decision: ReplanDecision
  projectId: string
  goalId: string
}): Promise<{ applied: number; newVersion: number }> => {
  let applied = 0
  const newVersion = state.plan_version + 1

  for (const patch of decision.patches) {
    if (patch.op === 'add_task') {
      await createTask({
        filename: patch.task.filename,
        id: patch.task.id,
        title: patch.task.title,
        project: projectId,
        owner: patch.task.owner,
        requiredCapabilities: patch.task.requiredCapabilities,
        priority: patch.task.priority,
        dependsOn: patch.task.dependsOn,
        outputPath: patch.task.outputPath,
        body: patch.task.body,
        createdBy: 'system',
        goalId,
        planVersion: newVersion,
      })
      applied += 1
      continue
    }

    if (patch.op === 'split_task') {
      const target = await findTaskById(patch.task_id)
      if (!target) continue
      target.frontmatter.status = 'done'
      target.frontmatter.completion_note = `Superseded by split: ${patch.replacement
        .map((task) => task.id)
        .join(', ')}`
      target.frontmatter.completed_at = nowIso()
      target.frontmatter.updated_at = nowIso()
      target.frontmatter.plan_version = newVersion
      await saveTask(target)

      for (const task of patch.replacement) {
        await createTask({
          filename: task.filename,
          id: task.id,
          title: task.title,
          project: projectId,
          owner: task.owner,
          requiredCapabilities: task.requiredCapabilities,
          priority: task.priority,
          dependsOn: task.dependsOn,
          outputPath: task.outputPath,
          body: task.body,
          createdBy: 'system',
          goalId,
          planVersion: newVersion,
        })
      }
      applied += 1
      continue
    }

    if (patch.op === 'reassign_owner') {
      const target = await findTaskById(patch.task_id)
      if (!target) continue
      target.frontmatter.owner = patch.owner
      target.frontmatter.updated_at = nowIso()
      target.frontmatter.plan_version = newVersion
      await saveTask(target)
      applied += 1
      continue
    }

    if (patch.op === 'change_dependencies') {
      const target = await findTaskById(patch.task_id)
      if (!target) continue
      target.frontmatter.depends_on = patch.dependsOn
      target.frontmatter.updated_at = nowIso()
      target.frontmatter.plan_version = newVersion
      await saveTask(target)
      applied += 1
      continue
    }

    if (patch.op === 'de_scope_task') {
      const target = await findTaskById(patch.task_id)
      if (!target) continue
      target.body = [target.body, '', '## Scope update', patch.note].join('\n').trim()
      target.frontmatter.priority = target.frontmatter.priority === 'critical' ? 'high' : 'medium'
      target.frontmatter.updated_at = nowIso()
      target.frontmatter.plan_version = newVersion
      await saveTask(target)
      applied += 1
      continue
    }

    if (patch.op === 'cancel_open_task') {
      const target = await findTaskById(patch.task_id)
      if (!target) continue
      target.frontmatter.status = 'done'
      target.frontmatter.completion_note = `Cancelled by replan: ${patch.reason}`
      target.frontmatter.completed_at = nowIso()
      target.frontmatter.updated_at = nowIso()
      target.frontmatter.plan_version = newVersion
      await saveTask(target)
      applied += 1
      continue
    }
  }

  return { applied, newVersion }
}

const writeReplanSnapshot = async ({
  version,
  triggerReason,
  decision,
}: {
  version: number
  triggerReason: string
  decision: ReplanDecision
}): Promise<void> => {
  await mkdir(PATHS.PLAN_DIR, { recursive: true })
  const path = `${PATHS.PLAN_DIR}/replan-v${String(version).padStart(3, '0')}.json`
  await writeFile(
    path,
    JSON.stringify(
      {
        at: nowIso(),
        triggerReason,
        decision,
      },
      null,
      2,
    ),
    'utf-8',
  )
}

export const maybeApplyReplan = async ({
  context,
  capabilityMap,
  emit,
  round,
  projectId,
  autoHuman,
}: {
  context: AutonomyContext
  capabilityMap: CapabilityMap
  emit: EmitFn
  round: number
  projectId: string
  autoHuman: boolean
}): Promise<AutonomyState> => {
  const diskState = await readStateFromDisk()
  const state = diskState ?? context.state

  if (state.remaining_replan_budget <= 0) {
    await emitSkipIfChanged({
      goalId: context.goal.id,
      reasonKey: 'budget-exhausted',
      emit,
      round,
      message: 'Replan budget exhausted.',
      data: { remaining_budget: state.remaining_replan_budget },
    })
    return state
  }

  const tasks = await listTasks()
  const trigger = detectReplanTrigger(tasks)
  if (!trigger) return state

  const snapshot = tasks.map((task) => ({
    id: task.frontmatter.id,
    title: task.frontmatter.title,
    owner: task.frontmatter.owner,
    status: task.frontmatter.status,
    attempt: task.frontmatter.attempt,
    depends_on: task.frontmatter.depends_on,
  }))

  const decision = await generateReplanDecision({
    goal: context.goal,
    capabilityMap,
    tasksSnapshot: snapshot,
    triggerReason: trigger.reason,
    maxNewTasksPerReplan: state.max_new_tasks_per_replan,
  })

  if (decision.patches.length === 0) {
    await emitSkipIfChanged({
      goalId: context.goal.id,
      reasonKey: `no-patches:${trigger.reason}`,
      emit,
      round,
      message: 'No replan patches proposed.',
      data: { trigger: trigger.reason, blocked_ratio: trigger.blockedRatio },
    })
    return state
  }

  const requiresApproval = decision.patches.some((patch) => patchNeedsManualApproval(patch))
  if (requiresApproval && state.approval_required_for.includes('scope_change') && !autoHuman) {
    await emit({
      type: 'replan.validation-failed',
      round,
      message: 'Replan requires manual approval and autoHuman=false.',
      data: { trigger: trigger.reason },
    })
    return state
  }

  const validationErrors = await validatePatchSet({ decision, capabilityMap, state, tasks })
  if (validationErrors.length > 0) {
    await emit({
      type: 'replan.validation-failed',
      round,
      message: validationErrors[0] ?? 'Replan patch set invalid.',
      data: { errors: validationErrors, trigger: trigger.reason },
    })
    return state
  }

  const { applied, newVersion } = await applyPatchSet({
    state,
    decision,
    projectId,
    goalId: context.goal.id,
  })

  if (applied === 0) return state

  const nextState: AutonomyState = {
    ...state,
    plan_version: newVersion,
    remaining_replan_budget: Math.max(0, state.remaining_replan_budget - 1),
    updated_at: nowIso(),
  }
  lastSkipReasonByGoal.delete(context.goal.id)
  await writeAutonomyState(nextState)
  await writeReplanSnapshot({
    version: newVersion,
    triggerReason: trigger.reason,
    decision,
  })

  logger.info('replan.applied', {
    version: newVersion,
    patches: decision.patches.length,
    applied,
    remaining_budget: nextState.remaining_replan_budget,
  })

  await emit({
    type: 'replan.applied',
    round,
    message: decision.rationale,
    data: {
      plan_version: newVersion,
      patches: decision.patches.length,
      applied,
      remaining_budget: nextState.remaining_replan_budget,
      trigger: trigger.reason,
    },
  })

  return nextState
}
