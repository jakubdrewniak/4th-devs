import type { AgentName, TaskFrontmatter } from '../types.js'

export interface WorkflowProjectMetadata {
  id: string
  title: string
  description: string
  deliverablePath: string
  goalId?: string
  planVersion?: number
}

export interface SeedTaskDefinition {
  filename: string
  id: string
  title: string
  owner: AgentName
  requiredCapabilities?: string[]
  priority: TaskFrontmatter['priority']
  dependsOn: string[]
  outputPath: string
  body: string
  goalId?: string
  planVersion?: number
}

export interface WorkflowDefinition {
  id: string
  project: WorkflowProjectMetadata
  agentOrder: AgentName[]
  tasks: SeedTaskDefinition[]
}
