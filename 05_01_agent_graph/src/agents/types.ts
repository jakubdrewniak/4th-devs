import type { ActorType } from '../domain.js'
import type { ActorToolName } from '../tools/types.js'

export interface AgentDefinition {
  name: string
  type: ActorType
  tools: ActorToolName[]
  instructions: string
  webSearch?: boolean
  maxSteps?: number
}
