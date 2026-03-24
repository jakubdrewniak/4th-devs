import { readFile } from 'node:fs/promises'
import matter from 'gray-matter'
import { PATHS, parsePositiveInt } from '../config/index.js'
import { exists } from '../helpers/fs.js'
import type { ApprovalRequirement, GoalContract } from './types.js'

const DEFAULT_APPROVAL_REQUIREMENTS: ApprovalRequirement[] = [
  'scope_change',
  'deadline_change',
  'quality_downgrade',
]

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

const asApprovalRequirements = (value: unknown): ApprovalRequirement[] => {
  const values = asStringArray(value)
  const accepted = values.filter(
    (item): item is ApprovalRequirement =>
      item === 'scope_change' || item === 'deadline_change' || item === 'quality_downgrade',
  )
  return accepted.length > 0 ? accepted : DEFAULT_APPROVAL_REQUIREMENTS
}

const asGoalId = (value: unknown): string =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : `goal-${new Date().toISOString().slice(0, 10)}`

export const readGoalContract = async (goalPath: string = PATHS.GOAL_PATH): Promise<GoalContract | null> => {
  if (!(await exists(goalPath))) return null

  const raw = await readFile(goalPath, 'utf-8')
  const parsed = matter(raw)
  const frontmatter = parsed.data as Record<string, unknown>

  const objective =
    typeof frontmatter.objective === 'string' ? frontmatter.objective.trim() : parsed.content.trim()

  if (!objective) {
    throw new Error(`Invalid goal contract at ${goalPath}: "objective" is required.`)
  }

  const mustHave = asStringArray(frontmatter.must_have)
  if (mustHave.length === 0) {
    throw new Error(`Invalid goal contract at ${goalPath}: "must_have" must contain at least one item.`)
  }

  const forbidden = asStringArray(frontmatter.forbidden)
  const context = parsed.content.trim()

  return {
    id: asGoalId(frontmatter.id),
    objective,
    context,
    must_have: mustHave,
    forbidden,
    step_budget_rounds: parsePositiveInt(String(frontmatter.step_budget_rounds ?? ''), 12),
    replan_budget: parsePositiveInt(String(frontmatter.replan_budget ?? ''), 2),
    max_total_tasks: parsePositiveInt(String(frontmatter.max_total_tasks ?? ''), 16),
    max_new_tasks_per_replan: parsePositiveInt(String(frontmatter.max_new_tasks_per_replan ?? ''), 3),
    approval_required_for: asApprovalRequirements(frontmatter.approval_required_for),
  }
}
