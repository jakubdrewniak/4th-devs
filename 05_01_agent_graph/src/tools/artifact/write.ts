import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { log } from '../../log.js'
import { getString, getOptionalString } from '../args.js'
import { normalizeArtifactPath, writeArtifactContent, upsertArtifact } from './shared.js'
import { resolveFilePlaceholders } from './placeholders.js'

export const definition: FunctionToolDefinition = {
  name: 'write_artifact',
  description: 'Write or update an artifact file for the current task.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative artifact path. Never use absolute paths.' },
      content: { type: 'string', description: 'Full file contents' },
      kind: {
        type: 'string',
        enum: ['file', 'plan', 'diff', 'image'],
        description: 'Artifact kind. Default is file.',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call, task, rt }) => {
  const artifactPath = normalizeArtifactPath(getString(call.arguments.path, 'path'))
  const content = await resolveFilePlaceholders(getString(call.arguments.content, 'content'), rt)
  const kind = getOptionalString(call.arguments.kind)
  const resolvedKind = (kind === 'plan' || kind === 'file' || kind === 'diff' || kind === 'image')
    ? kind : 'file'

  await writeArtifactContent(rt, artifactPath, content)
  log.artifact('wrote', artifactPath, content.length)
  const artifact = await upsertArtifact(rt, task, artifactPath, resolvedKind, content)

  return {
    status: 'continue',
    message: `Wrote artifact ${artifact.path}`,
    output: JSON.stringify({
      artifactId: artifact.id, path: artifact.path, kind: artifact.kind,
      version: artifact.version, chars: content.length,
    }),
  }
}
