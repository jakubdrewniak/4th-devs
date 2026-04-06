export type { AgentDefinition } from './types.js'

import type { AgentDefinition } from './types.js'
import { orchestrator } from './orchestrator.js'
import { researcher } from './researcher.js'
import { writer } from './writer.js'
import { email_writer } from './email_writer.js'

const agents: Record<string, AgentDefinition> = {
  orchestrator,
  researcher,
  writer,
  email_writer,
}

export const bootstrapAgents = ['orchestrator'] as const

export const agentNames = Object.keys(agents)

export const getAgentDefinition = (name: string): AgentDefinition | undefined =>
  agents[name]
