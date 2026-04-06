import type { FunctionToolDefinition } from '../../ai/index.js'
import type { ToolHandler } from '../types.js'
import { log } from '../../log.js'
import { getString, getOptionalString } from '../args.js'
import { normalizeArtifactPath, writeArtifactContent, upsertArtifact } from '../artifact/shared.js'
import { resolveFilePlaceholders } from '../artifact/placeholders.js'

export const definition: FunctionToolDefinition = {
  name: 'send_email',
  description: 'Compose and send an email. The email is saved as a formatted markdown file in the artifacts. Use {{file:path}} in the body to inline content from an existing artifact.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Comma-separated recipient email addresses' },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Email body in markdown. Use {{file:path}} to include artifact content inline.' },
      cc: { type: 'string', description: 'Optional CC recipients' },
    },
    required: ['to', 'subject', 'body'],
    additionalProperties: false,
  },
}

export const handle: ToolHandler = async ({ call, task, rt }) => {
  const to = getString(call.arguments.to, 'to')
  const subject = getString(call.arguments.subject, 'subject')
  const rawBody = getString(call.arguments.body, 'body')
  const cc = getOptionalString(call.arguments.cc)

  const body = await resolveFilePlaceholders(rawBody, rt)

  const timestamp = new Date().toISOString()
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
  const emailPath = normalizeArtifactPath(`emails/${slug}.md`)

  const content = [
    '---',
    `to: ${to}`,
    cc ? `cc: ${cc}` : null,
    `subject: ${subject}`,
    `date: ${timestamp}`,
    `status: sent`,
    '---',
    '',
    body,
  ].filter(v => v !== null).join('\n')

  await writeArtifactContent(rt, emailPath, content)
  log.artifact('wrote', emailPath, content.length)
  const artifact = await upsertArtifact(rt, task, emailPath, 'file', content)

  return {
    status: 'continue',
    message: `Email sent to ${to}: "${subject}"`,
    output: JSON.stringify({
      artifactId: artifact.id, path: artifact.path,
      to, cc: cc ?? null, subject, chars: content.length,
    }),
  }
}
