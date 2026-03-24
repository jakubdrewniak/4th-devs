import type { GoalContract, PlanDecision, PlanValidationResult } from './types.js'

export const toNoGoDecision = (
  decision: PlanDecision,
  validation: PlanValidationResult,
): Extract<PlanDecision, { status: 'no-go' }> => {
  const reasons = [
    ...(decision.status === 'no-go' ? decision.reasons : []),
    ...validation.errors,
  ].filter(Boolean)

  const missingCapabilities = [
    ...(decision.status === 'no-go' ? decision.missingCapabilities : []),
    ...validation.missingCapabilities,
  ]

  const dedupedReasons = [...new Set(reasons)]
  const dedupedMissing = [...new Set(missingCapabilities)]

  return {
    status: 'no-go',
    reasons: dedupedReasons.length > 0 ? dedupedReasons : ['Planner could not produce a valid plan.'],
    missingCapabilities: dedupedMissing,
    suggestedActions:
      dedupedMissing.length > 0
        ? [
            `Add team members or tools covering: ${dedupedMissing.join(', ')}`,
            'Relax must_have or forbidden constraints, then rerun planning.',
          ]
        : ['Relax constraints or clarify objective, then rerun planning.'],
  }
}

export const isClearlyNoGo = (
  goal: GoalContract,
  decision: PlanDecision,
  validation: PlanValidationResult,
): boolean => {
  if (decision.status === 'no-go') return true
  if (!validation.ok) return true
  if (decision.status === 'viable' && decision.plan.tasks.length > goal.max_total_tasks) return true
  return false
}
