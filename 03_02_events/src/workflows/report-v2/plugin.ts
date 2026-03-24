import type { WorkflowDefinition } from '../types.js'
import { buildReportV2SeedTasks, REPORT_V2_PROJECT } from './task-seeds.js'

export const reportV2Workflow: WorkflowDefinition = {
  id: 'report-v2',
  project: REPORT_V2_PROJECT,
  agentOrder: ['researcher', 'designer', 'writer', 'planner', 'editor'],
  tasks: buildReportV2SeedTasks(),
}
