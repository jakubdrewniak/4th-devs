import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { PATHS } from '../config/index.js'
import { loadAgentTemplate } from '../helpers/agent-template.js'
import type { AgentName } from '../types.js'
import type { CapabilityMap } from './types.js'

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)]

const listAgentNamesFromWorkspace = async (): Promise<AgentName[]> => {
  const files = (await readdir(PATHS.AGENTS_DIR)).filter((file) => file.endsWith('.agent.md'))
  return files.map((file) => basename(file, '.agent.md') as AgentName)
}

const toCapabilityEntry = async (agentName: AgentName) => {
  const template = await loadAgentTemplate(agentName)
  return [
    agentName,
    {
      capabilities: template.capabilities,
      tools: template.tools,
    },
  ] as const
}

export const buildCapabilityMap = async (agentNames?: readonly AgentName[]): Promise<CapabilityMap> => {
  const names = agentNames ? unique(agentNames) : await listAgentNamesFromWorkspace()

  const entries = await Promise.all(names.map((agentName) => toCapabilityEntry(agentName)))

  return new Map(entries)
}
