import type { AgentName, TaskPriority } from '../types.js'
import type { WorkflowDefinition, WorkflowProjectMetadata } from '../workflows/types.js'

export type ApprovalRequirement = 'scope_change' | 'deadline_change' | 'quality_downgrade'

export interface GoalContract {
  id: string
  objective: string
  context: string
  must_have: string[]
  forbidden: string[]
  step_budget_rounds: number
  replan_budget: number
  max_total_tasks: number
  max_new_tasks_per_replan: number
  approval_required_for: ApprovalRequirement[]
}

export interface PlanTaskSpec {
  filename: string
  id: string
  title: string
  owner: AgentName
  requiredCapabilities?: string[]
  priority: TaskPriority
  dependsOn: string[]
  outputPath: string
  body: string
  successCriteria: string[]
}

export interface PlanSpec {
  project: WorkflowProjectMetadata
  agentOrder: AgentName[]
  tasks: PlanTaskSpec[]
  assumptions: string[]
  risks: string[]
  mustHaveCoverage: Record<string, string[]>
}

export type PlanDecision =
  | {
      status: 'viable'
      plan: PlanSpec
    }
  | {
      status: 'no-go'
      reasons: string[]
      missingCapabilities: string[]
      suggestedActions: string[]
    }

export interface PlanValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  missingCapabilities: string[]
}

export interface CapabilitySnapshot {
  capabilities: string[]
  tools: string[]
}

export type CapabilityMap = Map<AgentName, CapabilitySnapshot>

export interface AutonomyState {
  goal_id: string
  plan_version: number
  remaining_replan_budget: number
  max_new_tasks_per_replan: number
  approval_required_for: ApprovalRequirement[]
  created_at: string
  updated_at: string
}

export type ReplanPatch =
  | {
      op: 'add_task'
      task: PlanTaskSpec
      reason: string
    }
  | {
      op: 'split_task'
      task_id: string
      replacement: PlanTaskSpec[]
      reason: string
    }
  | {
      op: 'reassign_owner'
      task_id: string
      owner: AgentName
      reason: string
    }
  | {
      op: 'change_dependencies'
      task_id: string
      dependsOn: string[]
      reason: string
    }
  | {
      op: 'de_scope_task'
      task_id: string
      note: string
      reason: string
    }
  | {
      op: 'cancel_open_task'
      task_id: string
      reason: string
    }

export interface ReplanDecision {
  rationale: string
  patches: ReplanPatch[]
}

export interface AutonomyResolution {
  mode: 'static' | 'autonomous' | 'no-go'
  workflow?: WorkflowDefinition
  goal?: GoalContract
  autonomyContext?: AutonomyContext
  planDecision?: PlanDecision
  validation?: PlanValidationResult
  noGoPath?: string
  noGoMessage?: string
}

export interface AutonomyContext {
  goal: GoalContract
  state: AutonomyState
}
