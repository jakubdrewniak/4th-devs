import { logger } from '../core/logger.js'
import { listTasks } from '../features/tasks/index.js'
import type { WorkflowDefinition } from '../workflows/types.js'
import { buildCapabilityMap } from './capability-map.js'
import { readGoalContract } from './contract.js'
import { isClearlyNoGo, toNoGoDecision } from './feasibility.js'
import {
  createInitialAutonomyState,
  toWorkflowFromPlan,
  writeAutonomyState,
  writeNoGoFile,
  writePlanSnapshot,
} from './materialize.js'
import { generatePlanDecision, repairPlanDecision } from './plan-generate.js'
import { validatePlanDecision } from './plan-validate.js'
import type { AutonomyResolution } from './types.js'

const MAX_PLAN_REPAIR_ATTEMPTS = 2

export type PlanProgressFn = (step: string, detail?: string) => void

const noop: PlanProgressFn = () => {}

export const resolveAutonomousWorkflow = async ({
  fallbackWorkflow,
  goalPath,
  onProgress = noop,
}: {
  fallbackWorkflow: WorkflowDefinition
  goalPath?: string
  onProgress?: PlanProgressFn
}): Promise<AutonomyResolution> => {
  onProgress('goal.check', goalPath ?? 'no goal path')
  const goal = await readGoalContract(goalPath)
  if (!goal) {
    onProgress('goal.absent', 'No goal contract found — using static workflow.')
    return {
      mode: 'static',
      workflow: fallbackWorkflow,
    }
  }

  onProgress('goal.loaded', `"${goal.objective}" (must_have=${goal.must_have.length}, forbidden=${goal.forbidden.length}, budget=${goal.step_budget_rounds} rounds)`)

  const existingTasks = await listTasks()
  if (existingTasks.length > 0) {
    const hasCompatibleGoal = existingTasks.every(
      (task) => task.frontmatter.goal_id && task.frontmatter.goal_id === goal.id,
    )
    if (!hasCompatibleGoal) {
      const validation = {
        ok: false,
        errors: [
          'Workspace already contains tasks that were not generated for this goal.',
          'Reset workspace tasks before running autonomous planning for a new goal.',
        ],
        warnings: [],
        missingCapabilities: [],
      }
      const noGoDecision = toNoGoDecision(
        {
          status: 'no-go',
          reasons: validation.errors,
          missingCapabilities: [],
          suggestedActions: ['Run demo/index with reset, or clear workspace/project/tasks manually.'],
        },
        validation,
      )
      const noGoPath = await writeNoGoFile({
        goal,
        decision: noGoDecision,
        validation,
      })
      await writePlanSnapshot({
        goal,
        decision: noGoDecision,
        validation,
        planVersion: 0,
      })
      return {
        mode: 'no-go',
        goal,
        planDecision: noGoDecision,
        validation,
        noGoPath,
        noGoMessage: noGoDecision.reasons[0],
      }
    }
  }

  onProgress('capability.scan', 'Scanning workspace/agents for available team...')
  const capabilityMap = await buildCapabilityMap()
  const agentSummary = [...capabilityMap.entries()]
    .map(([name, snap]) => `${name}(${snap.capabilities.join(',')})`)
    .join(' | ')
  onProgress('capability.ready', agentSummary)

  onProgress('plan.generate', 'Calling planner LLM to compile goal into tasks...')
  let { decision, raw } = await generatePlanDecision(goal, capabilityMap)
  let validation = validatePlanDecision(goal, decision, capabilityMap)

  if (decision.status === 'viable') {
    onProgress('plan.received', `Viable plan: ${decision.plan.tasks.length} tasks, ${decision.plan.agentOrder.length} agents`)
  } else {
    onProgress('plan.received', `No-go from planner: ${decision.reasons[0] ?? 'unknown'}`)
  }

  if (!validation.ok) {
    onProgress('plan.validate', `Validation failed: ${validation.errors.length} errors, ${validation.warnings.length} warnings`)
  } else if (validation.warnings.length > 0) {
    onProgress('plan.validate', `Validation passed with ${validation.warnings.length} warnings`)
  } else {
    onProgress('plan.validate', 'Validation passed.')
  }

  for (let attempt = 1; attempt <= MAX_PLAN_REPAIR_ATTEMPTS; attempt += 1) {
    if (decision.status === 'no-go' || validation.ok) break

    onProgress('plan.repair', `Repair attempt ${attempt}/${MAX_PLAN_REPAIR_ATTEMPTS} — fixing ${validation.errors.length} errors...`)
    logger.warn('plan.validation-failed', {
      goal_id: goal.id,
      attempt,
      errors: validation.errors,
    })

    const repaired = await repairPlanDecision(goal, capabilityMap, raw, validation.errors)
    decision = repaired.decision
    raw = repaired.raw
    validation = validatePlanDecision(goal, decision, capabilityMap)
    onProgress('plan.repair.result', validation.ok ? 'Repair succeeded.' : `Still ${validation.errors.length} errors.`)
  }

  if (isClearlyNoGo(goal, decision, validation)) {
    onProgress('plan.no-go', 'Plan is not feasible.')
    const noGoDecision = toNoGoDecision(decision, validation)
    const noGoPath = await writeNoGoFile({
      goal,
      decision: noGoDecision,
      validation,
    })

    await writePlanSnapshot({
      goal,
      decision: noGoDecision,
      validation,
      planVersion: 0,
    })

    logger.warn('plan.no-go', {
      goal_id: goal.id,
      reasons: noGoDecision.reasons,
      missing_capabilities: noGoDecision.missingCapabilities,
      path: noGoPath,
    })

    return {
      mode: 'no-go',
      goal,
      planDecision: noGoDecision,
      validation,
      noGoPath,
      noGoMessage: noGoDecision.reasons[0] ?? 'No-go.',
    }
  }

  if (decision.status !== 'viable') {
    throw new Error('Autonomy planner returned non-viable decision unexpectedly.')
  }

  const planVersion = 1
  onProgress('plan.snapshot', `Writing plan snapshot v${planVersion}...`)
  await writePlanSnapshot({
    goal,
    decision,
    validation,
    planVersion,
  })

  const state = createInitialAutonomyState(goal, planVersion)
  await writeAutonomyState(state)

  const workflow = toWorkflowFromPlan(goal, decision, planVersion)

  onProgress('plan.materialize', `Created ${workflow.tasks.length} task files → workflow "${workflow.id}"`)
  for (const task of workflow.tasks) {
    onProgress('plan.task', `  ${task.filename} → ${task.owner} [${task.priority}] "${task.title}"`)
  }

  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      onProgress('plan.warn', `  ⚠ ${warning}`)
    }
  }

  onProgress('plan.approved', `Plan approved. Replan budget: ${state.remaining_replan_budget}`)
  logger.info('plan.approved', {
    goal_id: goal.id,
    task_count: decision.plan.tasks.length,
    workflow_id: workflow.id,
  })

  return {
    mode: 'autonomous',
    workflow,
    goal,
    autonomyContext: { goal, state },
    planDecision: decision,
    validation,
  }
}
