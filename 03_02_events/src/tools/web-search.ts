import { resolveModelForProvider } from '../../../config.js'
import type { Tool } from '../types.js'

export const webSearchTools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'web_search',
      description: 'Search the web and return concise findings with sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    handler: async (args, ctx) => {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return { kind: 'text', content: 'Error: query is required' }

      try {
        const response = await ctx.openai.responses.create(
          {
            model: resolveModelForProvider(process.env.WEB_SEARCH_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.2'),
            input: `Search the web for: ${query}\nReturn concise findings with source URLs in markdown.`,
            tools: [{ type: 'web_search_preview' }],
          },
          ctx.abortSignal ? { signal: ctx.abortSignal } : undefined,
        )

        const text = response.output_text?.trim()
        if (text) return { kind: 'text', content: text }
        return { kind: 'text', content: 'Search completed but returned no text output.' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'text', content: `Error: web search failed (${message})` }
      }
    },
  },
]
