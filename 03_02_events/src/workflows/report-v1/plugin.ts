import type { WorkflowDefinition } from '../types.js'
import {
  buildReportV1SeedTasks,
  REPORT_V1_PROJECT,
} from './task-seeds.js'

export const reportV1Workflow: WorkflowDefinition = {
  id: 'report-v1',
  project: REPORT_V1_PROJECT,
  agentOrder: ['planner', 'researcher', 'designer', 'writer', 'editor'],
  tasks: buildReportV1SeedTasks(),
}
