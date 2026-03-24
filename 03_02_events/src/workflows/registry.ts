import { reportV1Workflow } from './report-v1/plugin.js'
import { reportV2Workflow } from './report-v2/plugin.js'
import type { WorkflowDefinition } from './types.js'

const WORKFLOWS: Record<string, WorkflowDefinition> = {
  [reportV1Workflow.id]: reportV1Workflow,
  [reportV2Workflow.id]: reportV2Workflow,
}

export const DEFAULT_WORKFLOW_ID = reportV1Workflow.id

export const listWorkflows = (): string[] => Object.keys(WORKFLOWS).sort()

export const resolveWorkflow = (workflowId?: string): WorkflowDefinition => {
  const requested = workflowId?.trim() ? workflowId.trim() : DEFAULT_WORKFLOW_ID
  const workflow = WORKFLOWS[requested]
  if (workflow) return workflow

  throw new Error(
    `Unknown workflow "${requested}". Available workflows: ${listWorkflows().join(', ')}`,
  )
}
