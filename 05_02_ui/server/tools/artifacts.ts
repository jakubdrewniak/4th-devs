import { randomUUID } from 'node:crypto'
import type { ArtifactKind } from '../../shared/chat'
import type { RegisteredTool } from './types'
import { asString, persistFile, slugify, stringifyOutput } from './shared'

export const createArtifactTool: RegisteredTool = {
  definition: {
    name: 'create_artifact',
    description: 'Create a reusable local artifact file for the conversation.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'json', 'text'] },
        content: {
          description: 'Artifact body. For JSON, pass an object or array.',
        },
        description: { type: 'string' },
      },
      required: ['title', 'format', 'content'],
      additionalProperties: false,
    },
  },
  async handle(args, ctx) {
    const title = asString(args.title, 'Artifact')
    const format = asString(args.format, 'markdown') as ArtifactKind
    const description = asString(args.description)
    const preview = format === 'json'
      ? stringifyOutput(args.content)
      : asString(args.content) || stringifyOutput(args.content)
    const extension = format === 'json' ? 'json' : format === 'text' ? 'txt' : 'md'
    const relativePath = `artifacts/${slugify(title)}-${randomUUID().slice(0, 8)}.${extension}`
    const savedPath = await persistFile(ctx.dataDir, relativePath, preview)

    return {
      output: {
        artifactPath: savedPath,
        kind: format,
      },
      artifacts: [{
        kind: format,
        title,
        description: description || 'Generated artifact saved locally.',
        path: savedPath,
        preview,
      }],
    }
  },
}
