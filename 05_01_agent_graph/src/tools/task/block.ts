import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { getString } from '../args.js'

export const definition: FunctionToolDefinition = {
  name: 'block_task',
  description: 'Block the current task when you cannot make progress.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why the task is blocked' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call }) => {
  const reason = getString(call.arguments.reason, 'reason')
  return { status: 'blocked', message: reason, output: JSON.stringify({ ok: false, reason }) }
}
