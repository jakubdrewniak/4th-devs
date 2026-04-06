import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { ensureRelation } from '../../runtime.js'
import { log } from '../../log.js'
import { getOptionalString } from '../args.js'
import {
  normalizeArtifactPath,
  readArtifactContent,
  getLatestArtifactByPath,
  MAX_READ_ARTIFACT_CHARS,
} from './shared.js'

export const definition: FunctionToolDefinition = {
  name: 'read_artifact',
  description: 'Read an existing artifact by artifact id or relative path.',
  parameters: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Exact artifact id if you already know it' },
      path: { type: 'string', description: 'Relative artifact path such as research/typescript-5.md' },
    },
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call, task, rt }) => {
  const artifactId = getOptionalString(call.arguments.artifactId)
  const requestedPath = getOptionalString(call.arguments.path)

  const artifact = artifactId
    ? await rt.artifacts.getById(artifactId)
    : requestedPath
      ? await getLatestArtifactByPath(task.session_id, normalizeArtifactPath(requestedPath), rt)
      : undefined

  if (!artifact || artifact.session_id !== task.session_id) {
    const all = await rt.artifacts.find(a => a.session_id === task.session_id)
    const available = all.map(a => a.path).join(', ') || 'none'
    throw new Error(`Artifact not found. Available artifacts: ${available}`)
  }

  const content = await readArtifactContent(rt, artifact.path)
  log.artifact('read', artifact.path, content.length)

  const truncated = content.length > MAX_READ_ARTIFACT_CHARS
  const visibleContent = truncated
    ? `${content.slice(0, MAX_READ_ARTIFACT_CHARS)}\n\n[truncated]`
    : content

  await ensureRelation(rt, task.session_id, 'task', task.id, 'uses', 'artifact', artifact.id)

  return {
    status: 'continue',
    message: `Read artifact ${artifact.path}`,
    output: JSON.stringify({
      artifactId: artifact.id, path: artifact.path, kind: artifact.kind,
      version: artifact.version, truncated, content: visibleContent,
    }),
  }
}
