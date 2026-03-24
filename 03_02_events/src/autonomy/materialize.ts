import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { PATHS } from '../config/index.js'
import { slugify } from '../helpers/paths.js'
import type { WorkflowDefinition } from '../workflows/types.js'
import type { AutonomyState, GoalContract, PlanDecision, PlanValidationResult } from './types.js'

const buildPlanSnapshotPath = (planVersion: number): string =>
  join(PATHS.PLAN_DIR, `plan-v${String(planVersion).padStart(3, '0')}.json`)

export const toWorkflowFromPlan = (
  goal: GoalContract,
  decision: Extract<PlanDecision, { status: 'viable' }>,
  planVersion: number,
): WorkflowDefinition => {
  const plan = decision.plan
  const workflowId = `autonomy-${slugify(goal.id)}-v${planVersion}`

  const taskSeeds: WorkflowDefinition['tasks'] = plan.tasks.map((task) => ({
    filename: task.filename,
    id: task.id,
    title: task.title,
    owner: task.owner,
    requiredCapabilities: task.requiredCapabilities,
    priority: task.priority,
    dependsOn: task.dependsOn,
    outputPath: task.outputPath,
    body: [
      task.body,
      '',
      '## Success Criteria',
      ...(task.successCriteria.length > 0 ? task.successCriteria.map((item) => `- ${item}`) : ['- Complete task objectives.']),
    ].join('\n'),
    goalId: goal.id,
    planVersion,
  }))

  return {
    id: workflowId,
    project: {
      ...plan.project,
      description: plan.project.description,
      goalId: goal.id,
      planVersion,
    },
    agentOrder: plan.agentOrder.length > 0 ? plan.agentOrder : [...new Set(taskSeeds.map((task) => task.owner))],
    tasks: taskSeeds,
  }
}

export const writePlanSnapshot = async ({
  goal,
  decision,
  validation,
  planVersion,
}: {
  goal: GoalContract
  decision: PlanDecision
  validation: PlanValidationResult
  planVersion: number
}): Promise<string> => {
  await mkdir(PATHS.PLAN_DIR, { recursive: true })
  const path = buildPlanSnapshotPath(planVersion)
  await writeFile(
    path,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        goal,
        decision,
        validation,
      },
      null,
      2,
    ),
    'utf-8',
  )
  return path
}

export const writeAutonomyState = async (state: AutonomyState): Promise<void> => {
  await mkdir(PATHS.PLAN_DIR, { recursive: true })
  await writeFile(PATHS.PLAN_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export const createInitialAutonomyState = (goal: GoalContract, planVersion: number): AutonomyState => {
  const now = new Date().toISOString()
  return {
    goal_id: goal.id,
    plan_version: planVersion,
    remaining_replan_budget: goal.replan_budget,
    max_new_tasks_per_replan: goal.max_new_tasks_per_replan,
    approval_required_for: goal.approval_required_for,
    created_at: now,
    updated_at: now,
  }
}

export const writeNoGoFile = async ({
  goal,
  decision,
  validation,
}: {
  goal: GoalContract
  decision: Extract<PlanDecision, { status: 'no-go' }>
  validation: PlanValidationResult
}): Promise<string> => {
  await mkdir(PATHS.WORKSPACE_DIR, { recursive: true })
  const content = matter.stringify(
    [
      `# No-Go: ${goal.objective}`,
      '',
      '## Why',
      ...decision.reasons.map((reason) => `- ${reason}`),
      '',
      ...(decision.missingCapabilities.length > 0
        ? ['## Missing capabilities', ...decision.missingCapabilities.map((capability) => `- ${capability}`), '']
        : []),
      ...(decision.suggestedActions.length > 0
        ? ['## Suggested actions', ...decision.suggestedActions.map((action) => `- ${action}`), '']
        : []),
      ...(validation.warnings.length > 0
        ? ['## Validation warnings', ...validation.warnings.map((warning) => `- ${warning}`), '']
        : []),
    ].join('\n'),
    {
      goal_id: goal.id,
      status: 'no-go',
      generated_at: new Date().toISOString(),
    },
  )

  await writeFile(PATHS.NO_GO_PATH, content, 'utf-8')
  return PATHS.NO_GO_PATH
}
