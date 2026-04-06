import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { getString } from '../args.js'

export const definition: FunctionToolDefinition = {
  name: 'complete_task',
  description: 'Mark the current task finished once the work is truly done.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Short summary of what was completed' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call }) => {
  const summary = getString(call.arguments.summary, 'summary')
  return { status: 'completed', message: summary, output: JSON.stringify({ ok: true, summary }) }
}
