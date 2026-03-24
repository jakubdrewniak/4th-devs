import { resolveModelForProvider } from '../../../config.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { ENV, PATHS } from '../config/index.js'
import type { AgentName, AgentTemplate } from '../types.js'

export const loadAgentTemplate = async (name: AgentName): Promise<AgentTemplate> => {
  const path = join(PATHS.AGENTS_DIR, `${name}.agent.md`)
  const raw = await readFile(path, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const templateName = typeof data.name === 'string' ? data.name.trim() : ''
  if (!templateName) {
    throw new Error(`Invalid agent template name in ${path}`)
  }

  const rawModel = typeof data.model === 'string' ? data.model : ENV.openaiModel

  return {
    name: templateName,
    model: resolveModelForProvider(rawModel),
    tools: Array.isArray(data.tools) ? data.tools.filter((item): item is string => typeof item === 'string') : [],
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    systemPrompt: parsed.content.trim(),
  }
}
