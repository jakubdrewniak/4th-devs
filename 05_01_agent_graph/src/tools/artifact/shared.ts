import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Task, Artifact, ArtifactKind } from '../../domain.js'
import type { Runtime } from '../../runtime.js'
import { addArtifact, ensureRelation } from '../../runtime.js'

const ARTIFACT_FILES_DIR = 'files'
export const MAX_READ_ARTIFACT_CHARS = 12_000

const artifactFilesRoot = (rt: Runtime): string =>
  path.join(rt.dataDir, ARTIFACT_FILES_DIR)

const artifactFilePath = (rt: Runtime, artifactPath: string): string =>
  path.join(artifactFilesRoot(rt), ...artifactPath.split('/'))

export const normalizeArtifactPath = (artifactPath: string): string => {
  const trimmed = artifactPath.replaceAll('\\', '/').trim()
  if (!trimmed) throw new Error('Artifact path must be a non-empty relative path')
  if (trimmed.startsWith('/')) throw new Error('Artifact path must be relative, not absolute')
  const normalized = path.posix.normalize(trimmed)
  if (normalized === '.' || normalized.startsWith('../')) {
    throw new Error('Artifact path cannot escape the artifact directory')
  }
  return normalized
}

export const readArtifactContent = (rt: Runtime, artifactPath: string): Promise<string> =>
  readFile(artifactFilePath(rt, artifactPath), 'utf8')

export async function writeArtifactContent(rt: Runtime, artifactPath: string, content: string): Promise<void> {
  const fullPath = artifactFilePath(rt, artifactPath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, 'utf8')
}

export async function getLatestArtifactByPath(
  sessionId: string,
  artifactPath: string,
  rt: Runtime,
): Promise<Artifact | undefined> {
  const matches = await rt.artifacts.find(
    a => a.session_id === sessionId && a.path === artifactPath,
  )
  return matches.sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at))[0]
}

export async function upsertArtifact(
  rt: Runtime,
  task: Task,
  artifactPath: string,
  kind: ArtifactKind,
  content: string,
): Promise<Artifact> {
  const metadata = {
    chars: content.length,
    format: artifactPath.endsWith('.md') ? 'markdown' : 'text',
  }

  const existing = await getLatestArtifactByPath(task.session_id, artifactPath, rt)
  if (!existing) {
    const created = await addArtifact(rt, task.session_id, kind, artifactPath, { metadata, taskId: task.id })
    await ensureRelation(rt, task.session_id, 'task', task.id, 'produces', 'artifact', created.id)
    return created
  }

  const updated = await rt.artifacts.update(existing.id, {
    version: existing.version + 1,
    task_id: task.id,
    metadata,
  })
  if (!updated) throw new Error(`Failed to update artifact: ${existing.id}`)

  await ensureRelation(rt, task.session_id, 'task', task.id, 'produces', 'artifact', updated.id)
  return updated
}
