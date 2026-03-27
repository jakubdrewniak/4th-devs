import { resolveModelForProvider } from '../../../config.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { ENV, PATHS } from '../config.js'
import type { AgentTemplate } from '../types.js'

export const loadAgentTemplate = async (name: string): Promise<AgentTemplate> => {
  const path = join(PATHS.templateDir, `${name}.agent.md`)
  const raw = await readFile(path, 'utf-8')
  const { data, content } = matter(raw)

  const defaultModel = name === 'scout' ? ENV.scoutModel : ENV.openaiModel
  const model = (data.model as string) ?? defaultModel

  return {
    name: (data.name as string) ?? name,
    model: resolveModelForProvider(model),
    tools: (data.tools as string[]) ?? [],
    systemPrompt: content.trim(),
  }
}
