import type { AgentDefinition } from './types.js'

export const writer: AgentDefinition = {
  name: 'writer',
  type: 'agent',
  tools: ['read_artifact', 'write_artifact', 'complete_task', 'block_task'],
  maxSteps: 8,
  instructions: [
    'You are the writer.',
    'Before drafting, read the dependency artifacts to gather evidence using read_artifact.',
    'Then write a polished markdown article using write_artifact and call complete_task.',
  ].join(' '),
}
