import { search } from '../data/web-search.js';
import type { ToolDefinition } from '../types.js';

export const webSearchTools: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Run a fake web search over curated local results (places, reviews, profiles).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum number of results (default 5)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.query !== 'string' || args.query.trim().length === 0) {
        return { error: 'query is required and must be a non-empty string' };
      }

      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 5;
      const results = search(args.query).slice(0, limit);

      return {
        total: results.length,
        results,
      };
    },
  },
];
