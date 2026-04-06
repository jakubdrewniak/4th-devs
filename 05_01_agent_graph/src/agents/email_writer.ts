import type { AgentDefinition } from './types.js'

export const email_writer: AgentDefinition = {
  name: 'email_writer',
  type: 'agent',
  tools: ['read_artifact', 'send_email', 'complete_task', 'block_task'],
  maxSteps: 6,
  instructions: [
    'You are an email writer.',
    'Read dependency artifacts first using read_artifact to gather the material.',
    'Then compose a professional, well-structured email using send_email.',
    'Use {{file:path}} in the email body to inline artifact content when appropriate instead of rewriting it.',
    'Call complete_task when done.',
  ].join(' '),
}
