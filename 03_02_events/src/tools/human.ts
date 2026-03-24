import { randomUUID } from 'node:crypto'
import type { Tool } from '../types.js'

export const humanTools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'request_human',
      description: 'Pause and request a human decision before continuing.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Clear and specific question for the human, include options if useful.',
          },
          wait_id: {
            type: 'string',
            description: 'Optional explicit wait id. If omitted it is generated automatically.',
          },
        },
        required: ['question'],
      },
    },
    handler: async (args) => {
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      if (!question) return { kind: 'text', content: 'Error: question is required' }

      const waitId =
        typeof args.wait_id === 'string' && args.wait_id.trim()
          ? args.wait_id.trim()
          : `wait-${randomUUID().slice(0, 8)}`

      return {
        kind: 'human_request',
        waitId,
        question,
      }
    },
  },
]
