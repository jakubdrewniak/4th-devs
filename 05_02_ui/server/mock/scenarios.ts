import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { previewChart, previewEmail, previewLaunchBrief, salesSummaryMarkdown } from '../data/mock-content'
import { PRODUCT_ROWS } from '../data/products'
import { slugify } from '../tools/shared'
import { createBuilder } from './builder'
import type { BuiltScenario, ScenarioName } from './types'

const persistArtifact = async (
  dataDir: string,
  relativePath: string,
  content: string,
): Promise<void> => {
  const filePath = path.join(dataDir, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export const detectScenario = (prompt: string, fallbackIndex = 0): ScenarioName => {
  const normalized = prompt.toLowerCase()

  if (/(sales|revenue|chart|report|performing products)/.test(normalized)) {
    return 'sales'
  }

  if (/(email|follow-up|follow up|subject line)/.test(normalized)) {
    return 'email'
  }

  if (/(artifact|launch brief|landing page|component|workspace)/.test(normalized)) {
    return 'artifact'
  }

  return (['research', 'sales', 'email', 'artifact'][fallbackIndex % 4] ?? 'research') as ScenarioName
}

const buildSalesScenario = (
  messageId: string,
  startSeq: number,
  startAt: number,
  dataDir: string,
  includeFiles: boolean,
): BuiltScenario => {
  const builder = createBuilder(messageId, startSeq, startAt)
  const chartPath = 'artifacts/top-products-feb-2026.md'

  builder.push('assistant_message_start', { title: 'Sales trend analysis' })
  builder.push('thinking_start', { label: 'Planning analysis' }, 300)
  builder.push('thinking_delta', { textDelta: 'Need the latest monthly snapshot plus a compact chart artifact.' }, 600)
  builder.push('thinking_end', {}, 400)
  builder.push(
    'text_delta',
    {
      textDelta:
        'I’m pulling the monthly sales snapshot first, then I’ll render the chart and explain what appears to be driving the trend.\n\n',
    },
    300,
  )
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:sales-report`,
      name: 'get_sales_report',
      args: {
        granularity: 'monthly',
        period: '2026-02',
        limit: 3,
      },
    },
    260,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:sales-report`,
      ok: true,
      output: {
        rows: PRODUCT_ROWS.slice(0, 3),
      },
    },
    2200,
  )
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:chart`,
      name: 'render_chart',
      args: {
        title: 'Top 3 Products — Feb 2026',
        chartType: 'bar',
        rows: PRODUCT_ROWS.slice(0, 3).map(row => ({
          label: row.name,
          value: row.revenue,
          note: row.note,
        })),
      },
    },
    400,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:chart`,
      ok: true,
      output: {
        artifactPath: chartPath,
        kind: 'markdown',
      },
    },
    1800,
  )
  builder.push(
    'artifact',
    {
      artifactId: `${messageId}:artifact`,
      kind: 'markdown',
      title: 'Top 3 Products — Feb 2026',
      description: 'A compact artifact preview emitted by the fake chart renderer.',
      path: includeFiles ? chartPath : undefined,
      preview: previewChart,
    },
    40,
    includeFiles
      ? () => persistArtifact(dataDir, chartPath, previewChart)
      : undefined,
  )
  builder.streamText(salesSummaryMarkdown, 400)
  builder.push('complete', { finishReason: 'stop' }, 200)

  return builder.build()
}

const buildEmailScenario = (
  messageId: string,
  startSeq: number,
  startAt: number,
  dataDir: string,
  includeFiles: boolean,
): BuiltScenario => {
  const builder = createBuilder(messageId, startSeq, startAt)
  const emailPath = `emails/${slugify(messageId)}.md`

  builder.push('assistant_message_start', { title: 'Follow-up email draft' })
  builder.push('thinking_start', { label: 'Shaping reply' }, 300)
  builder.push('thinking_delta', { textDelta: 'Need a crisp follow-up with explicit next steps.' }, 600)
  builder.push('thinking_end', {}, 400)
  builder.push(
    'text_delta',
    {
      textDelta: 'I’ll gather the context, compose the email, and then save the final version as a reusable artifact.\n\n',
    },
    220,
  )
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:context`,
      name: 'lookup_contact_context',
      args: {
        account: 'enterprise-lead',
        region: 'warsaw',
      },
    },
    180,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:context`,
      ok: true,
      output: {
        lastCall: 'reviewed the analytics workspace rollout',
        concern: 'wants clearer launch sequencing',
      },
    },
    1800,
  )
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:email`,
      name: 'send_email',
      args: {
        to: 'lead@example.com',
        subject: 'Next steps after the workspace review',
        body: previewEmail,
      },
    },
    160,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:email`,
      ok: true,
      output: {
        savedTo: emailPath,
      },
    },
    2200,
  )
  builder.push(
    'artifact',
    {
      artifactId: `${messageId}:artifact`,
      kind: 'markdown',
      title: 'Saved follow-up email',
      description: 'The fake email tool writes a markdown file instead of sending a real message.',
      path: includeFiles ? emailPath : undefined,
      preview: previewEmail,
    },
    50,
    includeFiles
      ? () => persistArtifact(dataDir, emailPath, previewEmail)
      : undefined,
  )
  builder.streamText(
    `The draft is saved and ready to inspect.

- It keeps the tone concise and forward-looking.
- The next steps are explicit, which makes the UI block useful for demos.
- The artifact can later be replaced by a richer editor or preview surface.`,
    400,
  )
  builder.push('complete', { finishReason: 'stop' }, 200)

  return builder.build()
}

const buildArtifactScenario = (
  messageId: string,
  startSeq: number,
  startAt: number,
  dataDir: string,
  includeFiles: boolean,
): BuiltScenario => {
  const builder = createBuilder(messageId, startSeq, startAt)
  const artifactPath = `artifacts/${slugify(messageId)}.md`

  builder.push('assistant_message_start', { title: 'Launch brief' })
  builder.push('thinking_start', { label: 'Structuring output' }, 300)
  builder.push('thinking_delta', { textDelta: 'Need a clear artifact, not just prose in the chat bubble.' }, 600)
  builder.push('thinking_end', {}, 400)
  builder.push(
    'text_delta',
    {
      textDelta: 'I’m creating a reusable launch brief artifact first so the UI can render a dedicated preview card.\n\n',
    },
    200,
  )
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:artifact`,
      name: 'create_artifact',
      args: {
        title: 'Launch brief',
        format: 'markdown',
        content: previewLaunchBrief,
      },
    },
    180,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:artifact`,
      ok: true,
      output: {
        artifactPath,
      },
    },
    2000,
  )
  builder.push(
    'artifact',
    {
      artifactId: `${messageId}:artifact`,
      kind: 'markdown',
      title: 'Launch Brief Artifact',
      description: 'A reusable markdown artifact that proves custom block rendering.',
      path: includeFiles ? artifactPath : undefined,
      preview: previewLaunchBrief,
    },
    40,
    includeFiles
      ? () => persistArtifact(dataDir, artifactPath, previewLaunchBrief)
      : undefined,
  )
  builder.streamText(
    `The launch brief is attached as a first-class artifact block.

- Keep the artifact preview lightweight in the message flow.
- Push heavy editing into a future dedicated surface.
- Preserve raw event history so the artifact can be re-materialized later.`,
    400,
  )
  builder.push('complete', { finishReason: 'stop' }, 200)

  return builder.build()
}

const buildResearchScenario = (
  messageId: string,
  startSeq: number,
  startAt: number,
): BuiltScenario => {
  const builder = createBuilder(messageId, startSeq, startAt)

  builder.push('assistant_message_start', { title: 'Research summary' })
  builder.push('thinking_start', { label: 'Compressing notes' }, 300)
  builder.push('thinking_delta', { textDelta: 'Need a crisp summary with enough structure for a block renderer.' }, 600)
  builder.push('thinking_end', {}, 400)
  builder.push(
    'tool_call',
    {
      toolCallId: `${messageId}:notes`,
      name: 'search_notes',
      args: {
        query: 'workspace onboarding friction',
        limit: 4,
      },
    },
    200,
  )
  builder.push(
    'tool_result',
    {
      toolCallId: `${messageId}:notes`,
      ok: true,
      output: {
        highlights: [
          'Users want clearer sequencing between setup steps.',
          'Artifact previews increase confidence during long tasks.',
          'Streaming tool cards reduce anxiety during waiting periods.',
        ],
      },
    },
    1800,
  )
  builder.streamText(
    `## Summary

- The strongest request is for **clearer step ordering** during onboarding.
- Users respond well when the interface makes intermediate work visible.
- Treat artifacts as durable UI objects, not just text attachments.

## Next action

Prototype the block materializer early so the UI can evolve independently from the transport layer.`,
    400,
  )
  builder.push('complete', { finishReason: 'stop' }, 200)

  return builder.build()
}

export const buildScenario = (
  scenario: ScenarioName,
  messageId: string,
  startSeq: number,
  startAt: number,
  dataDir: string,
  includeFiles: boolean,
): BuiltScenario => {
  switch (scenario) {
    case 'sales':
      return buildSalesScenario(messageId, startSeq, startAt, dataDir, includeFiles)
    case 'email':
      return buildEmailScenario(messageId, startSeq, startAt, dataDir, includeFiles)
    case 'artifact':
      return buildArtifactScenario(messageId, startSeq, startAt, dataDir, includeFiles)
    case 'research':
    default:
      return buildResearchScenario(messageId, startSeq, startAt)
  }
}
