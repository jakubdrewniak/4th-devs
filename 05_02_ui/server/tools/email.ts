import { randomUUID } from 'node:crypto'
import { CONTACT_CONTEXT } from '../data/contacts'
import type { RegisteredTool } from './types'
import { asString, persistFile, slugify } from './shared'

export const lookupContactContextTool: RegisteredTool = {
  definition: {
    name: 'lookup_contact_context',
    description: 'Look up mocked CRM context for a contact.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        region: { type: 'string' },
      },
      required: ['account'],
      additionalProperties: false,
    },
  },
  async handle(args) {
    const account = asString(args.account, 'enterprise-lead')
    const region = asString(args.region, 'global')
    const context = CONTACT_CONTEXT[account] ?? CONTACT_CONTEXT['enterprise-lead']

    return {
      output: {
        account,
        region,
        ...context,
      },
    }
  },
}

export const sendEmailTool: RegisteredTool = {
  definition: {
    name: 'send_email',
    description: 'Save a mocked outbound email as a local markdown file.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  async handle(args, ctx) {
    const to = asString(args.to)
    const subject = asString(args.subject)
    const body = asString(args.body)
    const content = [
      `# ${subject}`,
      '',
      `To: ${to}`,
      '',
      body,
    ].join('\n')
    const relativePath = `emails/${slugify(subject || to || 'email')}-${randomUUID().slice(0, 8)}.md`
    const savedPath = await persistFile(ctx.dataDir, relativePath, content)

    return {
      output: {
        savedTo: savedPath,
        delivered: false,
        mode: 'mock-file-only',
      },
      artifacts: [{
        kind: 'markdown',
        title: subject || 'Saved email',
        description: 'Mock email saved locally instead of being delivered.',
        path: savedPath,
        preview: content,
      }],
    }
  },
}
