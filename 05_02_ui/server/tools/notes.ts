import { NOTE_SNIPPETS } from '../data/notes'
import type { RegisteredTool } from './types'
import { asNumber, asString } from './shared'

export const searchNotesTool: RegisteredTool = {
  definition: {
    name: 'search_notes',
    description: 'Search mocked research notes and return highlights.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async handle(args) {
    const query = asString(args.query)
    const limit = Math.max(1, Math.min(10, Math.trunc(asNumber(args.limit, 3))))
    const normalized = query.toLowerCase()
    const leadingToken = normalized.split(/\s+/)[0] ?? ''
    const highlights = NOTE_SNIPPETS
      .filter(note => leadingToken.length === 0 || note.toLowerCase().includes(leadingToken))
      .slice(0, limit)

    return {
      output: {
        query,
        highlights: highlights.length > 0 ? highlights : NOTE_SNIPPETS.slice(0, limit),
      },
    }
  },
}
