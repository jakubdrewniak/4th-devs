import { PATHS } from '../config/index.js'
import { asRelativeSafePath, isPlainMarkdownFilename } from '../helpers/paths.js'
import type { AgentName } from '../types.js'
import type { CapabilityMap, GoalContract, PlanDecision, PlanSpec, PlanValidationResult } from './types.js'

const normalize = (value: string): string => value.trim().toLowerCase()

const hasUnique = (values: string[]): boolean => new Set(values).size === values.length

const collectPlanCorpus = (plan: PlanSpec): string =>
  [
    plan.project.title,
    plan.project.description,
    plan.project.deliverablePath,
    ...plan.tasks.flatMap((task) => [task.title, task.body, task.outputPath]),
  ]
    .join('\n')
    .toLowerCase()

const hasCycle = (plan: PlanSpec): boolean => {
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const dfs = (taskId: string): boolean => {
    if (visited.has(taskId)) return false
    if (visiting.has(taskId)) return true
    visiting.add(taskId)

    const task = taskById.get(taskId)
    if (task) {
      for (const dependency of task.dependsOn) {
        if (taskById.has(dependency) && dfs(dependency)) return true
      }
    }

    visiting.delete(taskId)
    visited.add(taskId)
    return false
  }

  for (const task of plan.tasks) {
    if (dfs(task.id)) return true
  }
  return false
}

const validateMustHaveCoverage = (
  goal: GoalContract,
  plan: PlanSpec,
  errors: string[],
  warnings: string[],
): void => {
  const taskIds = new Set(plan.tasks.map((task) => task.id))
  const coverageEntryByNormalizedKey = new Map(
    Object.keys(plan.mustHaveCoverage).map((key) => [normalize(key), key]),
  )

  for (const item of goal.must_have) {
    const key = normalize(item)
    const originalKey = coverageEntryByNormalizedKey.get(key)
    if (!originalKey) {
      errors.push(`Missing mustHaveCoverage entry for "${item}".`)
      continue
    }

    const linkedTasks = plan.mustHaveCoverage[originalKey] ?? []
    if (!Array.isArray(linkedTasks) || linkedTasks.length === 0) {
      errors.push(`mustHaveCoverage for "${item}" must reference at least one task id.`)
      continue
    }

    const unknown = linkedTasks.filter((taskId) => !taskIds.has(taskId))
    if (unknown.length > 0) {
      errors.push(`mustHaveCoverage for "${item}" references unknown tasks: ${unknown.join(', ')}`)
    }
  }

  const knownMustHave = new Set(goal.must_have.map(normalize))
  for (const [normalizedKey, originalKey] of coverageEntryByNormalizedKey.entries()) {
    if (!knownMustHave.has(normalizedKey)) {
      warnings.push(`mustHaveCoverage contains extra key "${originalKey}" not present in goal.must_have.`)
    }
  }
}

const validateTaskOwnersAndCapabilities = (
  plan: PlanSpec,
  capabilityMap: CapabilityMap,
  errors: string[],
  warnings: string[],
): string[] => {
  const missingCapabilities = new Set<string>()
  const allAgents = new Set<AgentName>([...capabilityMap.keys()])
  const allCapabilities = new Set<string>(
    [...capabilityMap.values()].flatMap((snapshot) => snapshot.capabilities),
  )
  const agentOrder = new Set(plan.agentOrder)

  for (const agent of plan.agentOrder) {
    if (!allAgents.has(agent)) {
      errors.push(`Plan agentOrder references unknown agent "${agent}".`)
    }
  }

  for (const task of plan.tasks) {
    if (!allAgents.has(task.owner)) {
      errors.push(`Task "${task.id}" references unknown owner "${task.owner}".`)
    }
    if (plan.agentOrder.length > 0 && !agentOrder.has(task.owner)) {
      warnings.push(`Task "${task.id}" owner "${task.owner}" is not present in plan.agentOrder.`)
    }

    const required = task.requiredCapabilities ?? []
    for (const capability of required) {
      if (!allCapabilities.has(capability)) {
        missingCapabilities.add(capability)
      }
      const ownerCaps = capabilityMap.get(task.owner)?.capabilities ?? []
      if (!ownerCaps.includes(capability)) {
        warnings.push(
          `Task "${task.id}" requires "${capability}" but owner "${task.owner}" does not advertise it.`,
        )
      }
    }
  }

  return [...missingCapabilities]
}

const validateDependencies = (plan: PlanSpec, errors: string[]): void => {
  const knownTaskIds = new Set(plan.tasks.map((task) => task.id))
  for (const task of plan.tasks) {
    const unknownDependencies = task.dependsOn.filter((dependencyId) => !knownTaskIds.has(dependencyId))
    if (unknownDependencies.length > 0) {
      errors.push(
        `Task "${task.id}" depends_on unknown ids: ${unknownDependencies.join(', ')}`,
      )
    }
    if (task.dependsOn.includes(task.id)) {
      errors.push(`Task "${task.id}" cannot depend on itself.`)
    }
  }

  if (hasCycle(plan)) {
    errors.push('Task dependency graph contains at least one cycle.')
  }
}

const validateForbidden = (goal: GoalContract, plan: PlanSpec, errors: string[]): void => {
  if (goal.forbidden.length === 0) return
  const corpus = collectPlanCorpus(plan)
  for (const forbidden of goal.forbidden) {
    if (!forbidden.trim()) continue
    if (corpus.includes(forbidden.toLowerCase())) {
      errors.push(`Plan includes forbidden phrase "${forbidden}".`)
    }
  }
}

export const validatePlanDecision = (
  goal: GoalContract,
  decision: PlanDecision,
  capabilityMap: CapabilityMap,
): PlanValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []
  let missingCapabilities: string[] = []

  if (decision.status === 'no-go') {
    if (decision.reasons.length === 0) {
      errors.push('No-go decision must include at least one reason.')
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      missingCapabilities: decision.missingCapabilities,
    }
  }

  const plan = decision.plan

  if (plan.tasks.length === 0) {
    errors.push('Viable plan must include at least one task.')
  }

  if (plan.tasks.length > goal.max_total_tasks) {
    errors.push(`Plan has ${plan.tasks.length} tasks but max_total_tasks=${goal.max_total_tasks}.`)
  }

  if (plan.tasks.length > goal.step_budget_rounds) {
    warnings.push(
      `Plan has ${plan.tasks.length} tasks and may exceed step_budget_rounds=${goal.step_budget_rounds}.`,
    )
  }

  if (!hasUnique(plan.tasks.map((task) => task.id))) {
    errors.push('Task IDs must be unique.')
  }
  if (!hasUnique(plan.tasks.map((task) => task.filename))) {
    errors.push('Task filenames must be unique.')
  }
  if (!hasUnique(plan.tasks.map((task) => task.outputPath))) {
    warnings.push('Some tasks share the same output path.')
  }

  const safeDeliverable = asRelativeSafePath(PATHS.WORKSPACE_DIR, plan.project.deliverablePath)
  if (!safeDeliverable) {
    errors.push(`Project deliverablePath is not workspace-safe: "${plan.project.deliverablePath}"`)
  }

  for (const task of plan.tasks) {
    const safeOutput = asRelativeSafePath(PATHS.WORKSPACE_DIR, task.outputPath)
    if (!safeOutput) {
      errors.push(`Task "${task.id}" has invalid outputPath "${task.outputPath}".`)
    }
    if (!isPlainMarkdownFilename(task.filename)) {
      errors.push(
        `Task "${task.id}" filename "${task.filename}" must be a plain markdown filename ending with .md.`,
      )
    }
  }

  validateDependencies(plan, errors)
  validateMustHaveCoverage(goal, plan, errors, warnings)
  validateForbidden(goal, plan, errors)
  missingCapabilities = validateTaskOwnersAndCapabilities(plan, capabilityMap, errors, warnings)

  if (missingCapabilities.length > 0) {
    errors.push(`Missing required team capabilities: ${missingCapabilities.join(', ')}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missingCapabilities,
  }
}
