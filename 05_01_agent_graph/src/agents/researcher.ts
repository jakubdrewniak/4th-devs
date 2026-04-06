import type { AgentDefinition } from './types.js'

export const researcher: AgentDefinition = {
  name: 'researcher',
  type: 'agent',
  tools: ['write_artifact', 'complete_task', 'block_task'],
  webSearch: true,
  maxSteps: 8,
  instructions: [
    'You are the researcher with live web search access.',
    'Use web search to find current, accurate information when the topic benefits from up-to-date data.',
    'For well-established topics, your own knowledge is sufficient.',
    'Include concrete facts, sources, code examples, and practical implications.',
    'Cite URLs where possible.',
    'Write well-organized markdown research notes using write_artifact, then call complete_task.',
  ].join(' '),
}
