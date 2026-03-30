import type { AgentContext, SearchReplaceOperation, Tool } from '../types.js'
import { artifactPackIds } from './capabilities.js'
import { generateArtifact } from './artifact-generator.js'
import { editArtifactWithSearchReplace } from './artifact-editor.js'

const extractBodySnippet = (html: string): string => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const source = bodyMatch?.[1] ?? html
  const normalized = source.replace(/<script[\s\S]*?<\/script>/gi, (chunk) =>
    chunk.length > 400 ? '<script>/* omitted */</script>' : chunk,
  )
  return normalized.slice(0, 5000)
}

const toSearchReplaceOperations = (value: unknown): SearchReplaceOperation[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): SearchReplaceOperation[] => {
    if (!item || typeof item !== 'object') return []
    const { search, replace, replaceAll, useRegex, caseSensitive, regexFlags } = item as Record<string, unknown>
    if (typeof search !== 'string' || typeof replace !== 'string') return []

    return [{
      search,
      replace,
      replaceAll: replaceAll === true,
      useRegex: useRegex === true,
      caseSensitive: typeof caseSensitive === 'boolean' ? caseSensitive : undefined,
      regexFlags: typeof regexFlags === 'string' ? regexFlags : undefined,
    }]
  })
}

export const createTools = (ctx: AgentContext): Tool[] => [
  {
    definition: {
      type: 'function',
      name: 'get_artifact',
      description: 'Get a summary and HTML body snippet of the currently displayed artifact.',
      parameters: { type: 'object', properties: {}, required: [] },
      strict: false,
    },
    handler: async () => {
      const artifact = ctx.getCurrentArtifact()
      if (!artifact) return 'No artifact is currently displayed.'
      return JSON.stringify({
        id: artifact.id,
        title: artifact.title,
        packs: artifact.packs,
        htmlLength: artifact.html.length,
        bodySnippet: extractBodySnippet(artifact.html),
      }, null, 2)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'create_artifact',
      description: 'Generate a self-contained HTML artifact for immediate browser preview. Use only for explicit build/create/generate requests.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to build.' },
          packs: {
            type: 'array',
            description: 'Capability packs to preload.',
            items: { type: 'string', enum: artifactPackIds },
          },
        },
        required: ['prompt'],
      },
      strict: false,
    },
    handler: async (args) => {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) return 'Error: prompt is required.'

      const packs = Array.isArray(args.packs)
        ? args.packs.filter((v): v is string => typeof v === 'string')
        : undefined

      try {
        const artifact = await generateArtifact(
          { prompt, packs, serverBaseUrl: ctx.serverBaseUrl },
          { onProgress: ctx.onProgress },
        )
        ctx.onArtifactChanged(artifact, 'created')
        return `Created "${artifact.title}" (id: ${artifact.id}, packs: ${artifact.packs.join(', ')}).`
      } catch (error) {
        return `Error creating artifact: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  },
  {
    definition: {
      type: 'function',
      name: 'edit_artifact',
      description: 'Edit the currently displayed artifact using search/replace operations on its HTML.',
      parameters: {
        type: 'object',
        properties: {
          instructions: { type: 'string', description: 'What to change.' },
          title: { type: 'string', description: 'Optional new title.' },
          replacements: {
            type: 'array',
            description: 'Search/replace operations to apply in order.',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string' },
                replace: { type: 'string' },
                replaceAll: { type: 'boolean' },
                useRegex: { type: 'boolean' },
                caseSensitive: { type: 'boolean' },
                regexFlags: { type: 'string' },
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['instructions', 'replacements'],
      },
      strict: false,
    },
    handler: async (args) => {
      const artifact = ctx.getCurrentArtifact()
      if (!artifact) return 'Error: no artifact to edit. Create one first.'

      const replacements = toSearchReplaceOperations(args.replacements)
      if (replacements.length === 0) return 'Error: no valid replacements provided.'

      const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : ''
      const title = typeof args.title === 'string' ? args.title : undefined

      ctx.onProgress?.({ phase: 'assembling_document', message: `Applying ${replacements.length} replacement(s)...` })

      const result = editArtifactWithSearchReplace({ artifact, replacements, instructions, title })
      const totalMatches = result.reports.reduce((sum, r) => sum + r.matches, 0)

      if (totalMatches === 0) {
        return `No search patterns matched the current HTML. Reports: ${JSON.stringify(result.reports)}`
      }

      ctx.onArtifactChanged(result.artifact, 'edited')
      return `Updated "${result.artifact.title}" with ${totalMatches} replacement(s). Reports: ${JSON.stringify(result.reports)}`
    },
  },
]
