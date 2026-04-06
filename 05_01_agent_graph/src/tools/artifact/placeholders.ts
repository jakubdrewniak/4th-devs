import type { Runtime } from '../../runtime.js'
import { readArtifactContent, normalizeArtifactPath } from './shared.js'

const PLACEHOLDER_RE = /\{\{file:([^}]+)\}\}/g

export async function resolveFilePlaceholders(content: string, rt: Runtime): Promise<string> {
  const matches = [...content.matchAll(PLACEHOLDER_RE)]
  if (matches.length === 0) return content

  let resolved = content
  for (const match of matches) {
    const rawPath = match[1].trim()
    try {
      const artifactPath = normalizeArtifactPath(rawPath)
      const fileContent = await readArtifactContent(rt, artifactPath)
      resolved = resolved.replace(match[0], fileContent)
    } catch {
      resolved = resolved.replace(match[0], `[file not found: ${rawPath}]`)
    }
  }

  return resolved
}
