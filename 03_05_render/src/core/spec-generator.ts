import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { openai, hasApiKey, ENV } from '../config.js'
import { logger } from '../logger.js'
import { RENDER_CATALOG_MANIFEST, resolveRenderPacks } from './catalog.js'
import { renderSpecToHtml } from './spec-to-html.js'
import type {
  GenerateRenderInput,
  GenerateRenderOptions,
  GenerateRenderProgress,
  RenderComponentId,
  RenderDocument,
  RenderSpec,
  ResolvedRenderPacks,
} from '../types.js'

interface RawRenderPayload {
  title: string
  summary?: string | null
  packs?: string[]
  spec: {
    root: string
    elements: Record<string, {
      type: string
      props?: Record<string, unknown>
      children?: string[]
    }>
  }
  state?: Record<string, unknown>
}

const payloadSchema: z.ZodType<RawRenderPayload> = z.object({
  title: z.string(),
  summary: z.string().nullable().optional(),
  packs: z.array(z.string()).optional(),
  spec: z.object({
    root: z.string(),
    elements: z.record(z.string(), z.object({
      type: z.string(),
      props: z.record(z.string(), z.unknown()).optional(),
      children: z.array(z.string()).optional(),
    })),
  }),
  state: z.record(z.string(), z.unknown()).optional(),
})

const extractJsonCandidates = (text: string): string[] => {
  const candidates = new Set<string>()
  const normalized = text.trim()
  if (normalized) candidates.add(normalized)

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) candidates.add(fencedMatch[1].trim())

  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(normalized.slice(firstBrace, lastBrace + 1))
  }

  return Array.from(candidates)
}

const parseModelPayload = (rawText: string): RawRenderPayload | null => {
  for (const candidate of extractJsonCandidates(rawText)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const checked = payloadSchema.safeParse(parsed)
      if (checked.success) {
        return checked.data
      }
    } catch {
      // Continue to next candidate.
    }
  }
  return null
}

const buildRenderInstructions = (packManifestForPrompt: string): string => [
  'You generate static, data-first dashboard specs constrained to allowed components.',
  'Return JSON only, no markdown, using this shape:',
  '{"title":"string","summary":"string|null","spec":{"root":"string","elements":{"id":{"type":"Component","props":{},"children":[]}}},"state":{}}',
  '',
  'Strict rules:',
  '- use ONLY allowed components from the selected packs',
  '- do NOT output HTML, CSS, JavaScript, markdown, or code fences',
  '- do NOT use interactive fields like on, repeat, visible',
  '- keep UI as a static snapshot focused on data communication',
  '- place realistic synthetic data in state',
  '- for chart/table data props, bind to state via {"$state":"/path"}',
  '- keep elements concise and under max element budget',
  '',
  packManifestForPrompt,
].join('\n')

const normalizeSpec = (
  payload: RawRenderPayload,
  packs: ResolvedRenderPacks,
): { title: string; summary: string | null; spec: RenderSpec; state: Record<string, unknown> } => {
  const title = payload.title.trim() || 'Untitled render'
  const summary = typeof payload.summary === 'string' && payload.summary.trim().length > 0
    ? payload.summary.trim()
    : null

  const rawEntries = Object.entries(payload.spec.elements)
  if (rawEntries.length === 0) {
    throw new Error('Spec has no elements.')
  }
  if (rawEntries.length > RENDER_CATALOG_MANIFEST.constraints.maxElements) {
    throw new Error(`Spec has too many elements (max ${RENDER_CATALOG_MANIFEST.constraints.maxElements}).`)
  }

  const allowedSet = new Set<RenderComponentId>(packs.allowedComponents)
  const unknownComponents = rawEntries
    .filter(([, element]) => !allowedSet.has(element.type as RenderComponentId))
    .map(([, element]) => element.type)
  if (unknownComponents.length > 0) {
    throw new Error(`Spec contains unsupported components: ${Array.from(new Set(unknownComponents)).join(', ')}`)
  }

  const normalizedElements = Object.fromEntries(
    rawEntries.map(([id, element]) => {
      const key = id.trim()
      const children = Array.isArray(element.children)
        ? element.children.filter((child) => typeof child === 'string' && child.trim().length > 0)
        : []
      return [key, {
        type: element.type as RenderComponentId,
        props: element.props ?? {},
        children,
      }]
    }),
  )

  const knownKeys = new Set(Object.keys(normalizedElements))
  for (const element of Object.values(normalizedElements)) {
    element.children = (element.children ?? []).filter((child) => knownKeys.has(child))
  }

  const root = knownKeys.has(payload.spec.root) ? payload.spec.root : Object.keys(normalizedElements)[0]
  if (!root) {
    throw new Error('Unable to determine spec root element.')
  }

  return {
    title,
    summary,
    spec: {
      root,
      elements: normalizedElements,
    },
    state: payload.state ?? {},
  }
}

const buildFallbackDocument = (
  prompt: string,
  packs: ResolvedRenderPacks,
): RenderDocument => {
  const title = `Local fallback: ${prompt.slice(0, 48) || 'Untitled'}`

  const state: Record<string, unknown> = {
    meta: {
      note: 'API key is missing, this render is generated locally.',
      prompt,
      generatedAt: new Date().toISOString(),
    },
    kpis: [
      { label: 'Qualified Leads', value: '128', detail: '+12% week-over-week', trend: 'up' },
      { label: 'Pipeline Value', value: '$1.24M', detail: '-3% vs plan', trend: 'down' },
      { label: 'Win Rate', value: '31.8%', detail: 'Stable', trend: 'neutral' },
    ],
    trend: [
      { month: 'Jan', revenue: 182000 },
      { month: 'Feb', revenue: 176000 },
      { month: 'Mar', revenue: 191000 },
      { month: 'Apr', revenue: 204000 },
    ],
    topChannels: [
      { channel: 'Organic', revenue: 227000, target: 205000 },
      { channel: 'Paid', revenue: 178000, target: 171000 },
      { channel: 'Partner', revenue: 127000, target: 110000 },
    ],
  }

  const spec: RenderSpec = {
    root: 'root-stack',
    elements: {
      'root-stack': {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'md' },
        children: ['header-card', 'kpi-grid', 'trend-card', 'table-card'],
      },
      'header-card': {
        type: 'Card',
        props: { title: 'Render fallback', description: 'Local preview with static synthetic data.' },
        children: ['header-text'],
      },
      'header-text': {
        type: 'Text',
        props: { content: { $state: '/meta/note' } },
        children: [],
      },
      'kpi-grid': {
        type: 'Grid',
        props: { columns: 3, gap: 'md' },
        children: ['metric-1', 'metric-2', 'metric-3'],
      },
      'metric-1': {
        type: 'Metric',
        props: {
          label: { $state: '/kpis/0/label' },
          value: { $state: '/kpis/0/value' },
          detail: { $state: '/kpis/0/detail' },
          trend: { $state: '/kpis/0/trend' },
        },
        children: [],
      },
      'metric-2': {
        type: 'Metric',
        props: {
          label: { $state: '/kpis/1/label' },
          value: { $state: '/kpis/1/value' },
          detail: { $state: '/kpis/1/detail' },
          trend: { $state: '/kpis/1/trend' },
        },
        children: [],
      },
      'metric-3': {
        type: 'Metric',
        props: {
          label: { $state: '/kpis/2/label' },
          value: { $state: '/kpis/2/value' },
          detail: { $state: '/kpis/2/detail' },
          trend: { $state: '/kpis/2/trend' },
        },
        children: [],
      },
      'trend-card': {
        type: 'Card',
        props: { title: 'Revenue trend' },
        children: ['trend-chart'],
      },
      'trend-chart': {
        type: 'LineChart',
        props: {
          title: 'Monthly revenue',
          data: { $state: '/trend' },
          xKey: 'month',
          yKey: 'revenue',
        },
        children: [],
      },
      'table-card': {
        type: 'Card',
        props: { title: 'Channel performance' },
        children: ['channel-table'],
      },
      'channel-table': {
        type: 'Table',
        props: {
          columns: [
            { key: 'channel', label: 'Channel' },
            { key: 'revenue', label: 'Revenue' },
            { key: 'target', label: 'Target' },
          ],
          data: { $state: '/topChannels' },
        },
        children: [],
      },
    },
  }

  const html = renderSpecToHtml({ title, spec, state })
  return {
    id: randomUUID(),
    title,
    prompt,
    summary: 'Fallback document rendered without model access.',
    spec,
    state,
    html,
    model: 'local-fallback',
    packs: packs.loaded.map((pack) => pack.id),
    createdAt: new Date().toISOString(),
  }
}

export const generateRenderDocument = async (
  input: GenerateRenderInput,
  options: GenerateRenderOptions = {},
): Promise<RenderDocument> => {
  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new Error('Prompt cannot be empty.')
  }

  options.onProgress?.({
    phase: 'interpreting_request',
    message: 'Resolving component packs...',
  })

  const packs = resolveRenderPacks(input.packs)
  if (packs.missing.length > 0) {
    logger.warn('render.packs_missing', { missing: packs.missing })
  }

  if (!hasApiKey) {
    logger.warn('render.fallback_used', { reason: 'missing_api_key' })
    options.onProgress?.({
      phase: 'assembling_document',
      message: 'API key missing, rendering local fallback document.',
    })
    return buildFallbackDocument(prompt, packs)
  }

  options.onProgress?.({
    phase: 'calling_model',
    message: `Generating render spec with ${ENV.model}...`,
  })

  let payload: RawRenderPayload | null = null
  try {
    const response = await openai.responses.create({
      model: ENV.model,
      reasoning: { effort: ENV.reasoningEffort },
      instructions: buildRenderInstructions(packs.manifestForPrompt),
      input: [
        `User request:\n${prompt}`,
        `Selected packs: ${packs.loaded.map((pack) => pack.id).join(', ')}`,
        'Generate realistic synthetic business data in state.',
        'Return strict JSON only.',
      ].join('\n\n'),
    })
    payload = parseModelPayload(response.output_text ?? '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Model request failed: ${message}`)
  }

  if (!payload) {
    throw new Error('Model returned an invalid payload. Expected JSON with title/spec/state.')
  }

  options.onProgress?.({
    phase: 'assembling_document',
    message: 'Validating spec and preparing preview HTML...',
  })

  const normalized = normalizeSpec(payload, packs)
  const html = renderSpecToHtml({
    title: normalized.title,
    spec: normalized.spec,
    state: normalized.state,
  })

  return {
    id: randomUUID(),
    title: normalized.title,
    prompt,
    summary: normalized.summary,
    spec: normalized.spec,
    state: normalized.state,
    html,
    model: ENV.model,
    packs: packs.loaded.map((pack) => pack.id),
    createdAt: new Date().toISOString(),
  }
}
