import type {
  RenderCatalogManifest,
  RenderComponentDefinition,
  RenderComponentId,
  RenderPackDefinition,
  RenderPackId,
  ResolvedRenderPacks,
} from '../types.js'

const COMPONENTS: Record<RenderComponentId, RenderComponentDefinition> = {
  Stack: {
    id: 'Stack',
    description: 'Flexible layout container for vertical/horizontal grouping.',
    propsGuide: [
      'direction: "vertical" | "horizontal"',
      'gap: "sm" | "md" | "lg"',
      'align: "start" | "center" | "end" | "stretch"',
      'justify: "start" | "center" | "end" | "between"',
    ],
  },
  Grid: {
    id: 'Grid',
    description: 'Grid layout for multi-column dashboard sections.',
    propsGuide: ['columns: number (1..4)', 'gap: "sm" | "md" | "lg"'],
  },
  Card: {
    id: 'Card',
    description: 'Panel container for metrics, charts, and grouped content.',
    propsGuide: ['title?: string', 'description?: string'],
  },
  Heading: {
    id: 'Heading',
    description: 'Section heading.',
    propsGuide: ['text: string', 'level?: "h1" | "h2" | "h3" | "h4"'],
  },
  Text: {
    id: 'Text',
    description: 'Body or helper text.',
    propsGuide: ['content: string', 'muted?: boolean'],
  },
  Badge: {
    id: 'Badge',
    description: 'Compact status pill.',
    propsGuide: ['text: string', 'variant?: "default" | "success" | "warning" | "danger"'],
  },
  Separator: {
    id: 'Separator',
    description: 'Visual divider between sections.',
    propsGuide: [],
  },
  Metric: {
    id: 'Metric',
    description: 'KPI value with optional trend and context.',
    propsGuide: [
      'label: string',
      'value: string',
      'detail?: string',
      'trend?: "up" | "down" | "neutral"',
    ],
  },
  LineChart: {
    id: 'LineChart',
    description: 'Time-series or continuous trend chart.',
    propsGuide: ['title?: string', 'data: array', 'xKey: string', 'yKey: string', 'height?: number'],
  },
  BarChart: {
    id: 'BarChart',
    description: 'Category comparison chart.',
    propsGuide: ['title?: string', 'data: array', 'xKey: string', 'yKey: string', 'height?: number'],
  },
  Table: {
    id: 'Table',
    description: 'Structured tabular data display.',
    propsGuide: [
      'columns: Array<{ key: string, label: string }>',
      'data: array',
      'emptyMessage?: string',
    ],
  },
  Alert: {
    id: 'Alert',
    description: 'High-priority alert or warning.',
    propsGuide: ['title: string', 'message?: string', 'tone?: "info" | "success" | "warning" | "danger"'],
  },
  Callout: {
    id: 'Callout',
    description: 'Narrative insight or recommendation block.',
    propsGuide: ['title?: string', 'content: string', 'type?: "info" | "tip" | "warning" | "important"'],
  },
  Accordion: {
    id: 'Accordion',
    description: 'Collapsible long-form insights.',
    propsGuide: ['items: Array<{ title: string, content: string }>'],
  },
  Input: {
    id: 'Input',
    description: 'Text input for parameterized dashboards.',
    propsGuide: ['label?: string', 'value?: string', 'placeholder?: string'],
  },
  Select: {
    id: 'Select',
    description: 'Single-select dropdown.',
    propsGuide: ['label?: string', 'value?: string', 'options: Array<{ value: string, label: string }>'],
  },
  RadioGroup: {
    id: 'RadioGroup',
    description: 'Choice group with mutually exclusive options.',
    propsGuide: ['label?: string', 'value?: string', 'options: Array<{ value: string, label: string }>'],
  },
  Switch: {
    id: 'Switch',
    description: 'Boolean toggle.',
    propsGuide: ['label?: string', 'checked?: boolean'],
  },
  Button: {
    id: 'Button',
    description: 'Action trigger button.',
    propsGuide: ['label: string', 'variant?: "default" | "secondary" | "danger"'],
  },
}

const PACKS: Record<RenderPackId, RenderPackDefinition> = {
  'analytics-core': {
    id: 'analytics-core',
    name: 'Analytics Core',
    description: 'Core layout and text components for dashboard structure.',
    components: ['Stack', 'Grid', 'Card', 'Heading', 'Text', 'Badge', 'Separator'],
  },
  'analytics-viz': {
    id: 'analytics-viz',
    name: 'Analytics Visuals',
    description: 'Visual KPI and chart components for trend/comparison analysis.',
    components: ['Metric', 'LineChart', 'BarChart'],
  },
  'analytics-table': {
    id: 'analytics-table',
    name: 'Analytics Tables',
    description: 'Tabular dataset presentation.',
    components: ['Table'],
  },
  'analytics-insight': {
    id: 'analytics-insight',
    name: 'Analytics Insights',
    description: 'Narrative and explanatory components for insights and recommendations.',
    components: ['Alert', 'Callout', 'Accordion'],
  },
  'analytics-controls': {
    id: 'analytics-controls',
    name: 'Analytics Controls',
    description: 'Interactive controls for filter and scenario variants.',
    components: ['Input', 'Select', 'RadioGroup', 'Switch', 'Button'],
  },
}

const PACK_IDS = Object.keys(PACKS) as RenderPackId[]
const DEFAULT_PACKS: RenderPackId[] = ['analytics-core', 'analytics-viz', 'analytics-table']

const dedupe = <T>(values: T[]): T[] => Array.from(new Set(values))

const resolvePromptComponents = (packs: RenderPackDefinition[]): RenderComponentDefinition[] =>
  dedupe(packs.flatMap((pack) => pack.components)).map((id) => COMPONENTS[id])

const formatPackForPrompt = (pack: RenderPackDefinition): string =>
  `- ${pack.id}: ${pack.description} (components: ${pack.components.join(', ')})`

const formatComponentForPrompt = (component: RenderComponentDefinition): string => {
  const props = component.propsGuide.length > 0 ? component.propsGuide.join('; ') : 'no props'
  return `- ${component.id}: ${component.description} (props: ${props})`
}

export const RENDER_CATALOG_MANIFEST: RenderCatalogManifest = {
  defaultPacks: DEFAULT_PACKS,
  constraints: {
    network: 'none',
    maxElements: 120,
  },
  packs: PACK_IDS.map((id) => PACKS[id]),
  components: Object.values(COMPONENTS),
}

export const renderPackIds = PACK_IDS

export const getCatalogManifestForPrompt = (selectedPacks: RenderPackDefinition[]): string => {
  const components = resolvePromptComponents(selectedPacks)
  return [
    'Render catalog manifest:',
    `- default packs: ${RENDER_CATALOG_MANIFEST.defaultPacks.join(', ')}`,
    `- constraints: network=${RENDER_CATALOG_MANIFEST.constraints.network}, max_elements=${RENDER_CATALOG_MANIFEST.constraints.maxElements}`,
    '- selected packs:',
    ...selectedPacks.map(formatPackForPrompt),
    '- allowed components:',
    ...components.map(formatComponentForPrompt),
  ].join('\n')
}

export const resolveRenderPacks = (requestedPackIds: string[] | undefined): ResolvedRenderPacks => {
  const normalizedRequested = Array.isArray(requestedPackIds)
    ? requestedPackIds
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
    : []

  const requested: RenderPackId[] = []
  const missing: string[] = []

  for (const value of normalizedRequested) {
    if (PACK_IDS.includes(value as RenderPackId)) {
      requested.push(value as RenderPackId)
    } else {
      missing.push(value)
    }
  }

  const resolvedIds = dedupe(requested.length > 0 ? requested : [...DEFAULT_PACKS])
  const loaded = resolvedIds.map((id) => PACKS[id])
  const allowedComponents = dedupe(loaded.flatMap((pack) => pack.components))

  return {
    requested: resolvedIds,
    loaded,
    missing,
    allowedComponents,
    manifestForPrompt: getCatalogManifestForPrompt(loaded),
  }
}
