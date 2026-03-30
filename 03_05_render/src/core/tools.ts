import type { AgentContext, RenderDocument, Tool } from '../types.js'
import { renderPackIds } from './catalog.js'
import { generateRenderDocument } from './spec-generator.js'

const documentSummary = (doc: RenderDocument): string => {
  const elementKeys = Object.keys(doc.spec.elements)
  return JSON.stringify({
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    packs: doc.packs,
    root: doc.spec.root,
    elementsCount: elementKeys.length,
    sampleElements: elementKeys.slice(0, 8),
    spec: doc.spec,
    state: doc.state,
  }, null, 2)
}

const buildEditPrompt = (doc: RenderDocument, instructions: string): string =>
  `You are editing an existing component-guardrailed render document.
Current title: ${doc.title}
Current summary: ${doc.summary ?? 'none'}
Current packs: ${doc.packs.join(', ')}

Current spec:
\`\`\`json
${JSON.stringify(doc.spec, null, 2)}
\`\`\`

Current state:
\`\`\`json
${JSON.stringify(doc.state, null, 2)}
\`\`\`

Edit instructions: ${instructions}
Regenerate an updated render document that applies these changes while preserving coherence.`

export const createTools = (ctx: AgentContext): Tool[] => [
  {
    definition: {
      type: 'function',
      name: 'get_document',
      description: 'Get the full spec, state, and metadata of the currently displayed render document.',
      parameters: { type: 'object', properties: {}, required: [] },
      strict: false,
    },
    handler: async () => {
      const doc = ctx.getCurrentDocument()
      if (!doc) return 'No document is currently displayed.'
      return documentSummary(doc)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'create_render',
      description: 'Generate a component-guardrailed render document (spec + state) for browser preview.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to build.' },
          packs: {
            type: 'array',
            description: 'Component packs to use.',
            items: { type: 'string', enum: renderPackIds },
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
        const doc = await generateRenderDocument(
          { prompt, packs },
          { onProgress: ctx.onProgress },
        )
        ctx.onDocumentChanged(doc)
        return `Created "${doc.title}" (id: ${doc.id}, packs: ${doc.packs.join(', ')}, ${Object.keys(doc.spec.elements).length} elements).`
      } catch (error) {
        return `Error creating document: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  },
  {
    definition: {
      type: 'function',
      name: 'edit_render',
      description: 'Modify the currently displayed render document by regenerating it with new instructions.',
      parameters: {
        type: 'object',
        properties: {
          instructions: { type: 'string', description: 'What to change.' },
          packs: {
            type: 'array',
            description: 'Optional pack override for regenerated document.',
            items: { type: 'string', enum: renderPackIds },
          },
        },
        required: ['instructions'],
      },
      strict: false,
    },
    handler: async (args) => {
      const current = ctx.getCurrentDocument()
      if (!current) return 'Error: no document to edit. Create one first.'

      const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : ''
      if (!instructions) return 'Error: instructions are required.'

      const packs = Array.isArray(args.packs)
        ? args.packs.filter((v): v is string => typeof v === 'string')
        : [...current.packs]

      try {
        const doc = await generateRenderDocument(
          { prompt: buildEditPrompt(current, instructions), packs },
          { onProgress: ctx.onProgress },
        )
        ctx.onDocumentChanged(doc)
        return `Updated "${doc.title}" (id: ${doc.id}, ${Object.keys(doc.spec.elements).length} elements).`
      } catch (error) {
        return `Error editing document: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  },
]
