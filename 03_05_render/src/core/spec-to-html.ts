import type { RenderSpec, RenderSpecElement } from '../types.js'

interface RenderHtmlInput {
  title: string
  spec: RenderSpec
  state: Record<string, unknown>
}

interface ColumnDefinition {
  key: string
  label: string
}

const GAP_MAP: Record<string, string> = {
  sm: '8px',
  md: '12px',
  lg: '18px',
}

const ALIGN_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

const JUSTIFY_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const toDisplay = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const getByPointer = (root: unknown, pointer: string): unknown => {
  if (!pointer.startsWith('/')) return undefined
  const segments = pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))

  let current: unknown = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

const resolveDynamic = (value: unknown, state: Record<string, unknown>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => resolveDynamic(item, state))
  }

  if (isRecord(value)) {
    if (typeof value.$state === 'string' && Object.keys(value).length === 1) {
      return getByPointer(state, value.$state)
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveDynamic(nested, state)]),
    )
  }

  return value
}

const toColumns = (value: unknown): ColumnDefinition[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((column): ColumnDefinition[] => {
    if (typeof column === 'string') {
      return [{ key: column, label: column }]
    }
    if (!isRecord(column)) return []
    if (typeof column.key !== 'string') return []
    const label = typeof column.label === 'string' ? column.label : column.key
    return [{ key: column.key, label }]
  })
}

const toRows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : []

const renderLineChart = (props: Record<string, unknown>): string => {
  const data = toRows(props.data)
  const xKey = typeof props.xKey === 'string' ? props.xKey : ''
  const yKey = typeof props.yKey === 'string' ? props.yKey : ''
  const title = typeof props.title === 'string' ? props.title : ''

  if (!xKey || !yKey || data.length === 0) {
    return '<div class="jr-chart-empty">No line-chart data.</div>'
  }

  const values = data
    .map((item) => Number(item[yKey]))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) {
    return '<div class="jr-chart-empty">No numeric values for line chart.</div>'
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const span = Math.max(1, maxValue - minValue)

  const points = data.map((item, index) => {
    const value = Number(item[yKey])
    const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100
    const y = Number.isFinite(value)
      ? 36 - ((value - minValue) / span) * 30
      : 36
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  const labels = data.map((item) => `<span>${escapeHtml(toDisplay(item[xKey]))}</span>`).join('')
  const chartTitle = title ? `<div class="jr-chart-title">${escapeHtml(title)}</div>` : ''

  return `
<section class="jr-chart jr-chart-line">
  ${chartTitle}
  <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <polyline fill="none" stroke="currentColor" stroke-width="1.9" points="${points}" />
  </svg>
  <div class="jr-chart-labels">${labels}</div>
</section>`
}

const renderBarChart = (props: Record<string, unknown>): string => {
  const data = toRows(props.data)
  const xKey = typeof props.xKey === 'string' ? props.xKey : ''
  const yKey = typeof props.yKey === 'string' ? props.yKey : ''
  const title = typeof props.title === 'string' ? props.title : ''

  if (!xKey || !yKey || data.length === 0) {
    return '<div class="jr-chart-empty">No bar-chart data.</div>'
  }

  const rows = data.map((item) => {
    const raw = Number(item[yKey])
    return {
      label: toDisplay(item[xKey]),
      value: Number.isFinite(raw) ? raw : 0,
    }
  })

  const max = Math.max(1, ...rows.map((row) => row.value))
  const bars = rows.map((row) => {
    const width = Math.max(0, (row.value / max) * 100)
    return `
<div class="jr-bar-row">
  <div class="jr-bar-label">${escapeHtml(row.label)}</div>
  <div class="jr-bar-track"><div class="jr-bar-fill" style="width:${width.toFixed(2)}%"></div></div>
  <div class="jr-bar-value">${escapeHtml(toDisplay(row.value))}</div>
</div>`
  }).join('')

  const chartTitle = title ? `<div class="jr-chart-title">${escapeHtml(title)}</div>` : ''

  return `
<section class="jr-chart jr-chart-bar">
  ${chartTitle}
  <div class="jr-bar-list">${bars}</div>
</section>`
}

const renderElement = (
  elementId: string,
  elements: Record<string, RenderSpecElement>,
  state: Record<string, unknown>,
  stack: Set<string>,
  depth: number,
): string => {
  if (depth > 40) return '<div class="jr-warning">Render depth limit reached.</div>'
  if (stack.has(elementId)) return '<div class="jr-warning">Cyclic element reference detected.</div>'

  const element = elements[elementId]
  if (!element) return `<div class="jr-warning">Missing element: ${escapeHtml(elementId)}</div>`

  const nextStack = new Set(stack)
  nextStack.add(elementId)
  const props = isRecord(resolveDynamic(element.props ?? {}, state))
    ? resolveDynamic(element.props ?? {}, state) as Record<string, unknown>
    : {}
  const children = (element.children ?? [])
    .map((childId) => renderElement(childId, elements, state, nextStack, depth + 1))
    .join('')

  switch (element.type) {
    case 'Stack': {
      const direction = props.direction === 'horizontal' ? 'row' : 'column'
      const gap = GAP_MAP[String(props.gap ?? 'md')] ?? GAP_MAP.md
      const align = ALIGN_MAP[String(props.align ?? '')] ?? 'stretch'
      const justify = JUSTIFY_MAP[String(props.justify ?? '')] ?? 'flex-start'
      return `<section class="jr-stack" style="display:flex;flex-direction:${direction};gap:${gap};align-items:${align};justify-content:${justify};">${children}</section>`
    }
    case 'Grid': {
      const columns = Number(props.columns)
      const normalizedColumns = Number.isInteger(columns) ? Math.max(1, Math.min(4, columns)) : 2
      const gap = GAP_MAP[String(props.gap ?? 'md')] ?? GAP_MAP.md
      return `<section class="jr-grid" style="display:grid;grid-template-columns:repeat(${normalizedColumns},minmax(0,1fr));gap:${gap};">${children}</section>`
    }
    case 'Card': {
      const title = typeof props.title === 'string' ? props.title : ''
      const description = typeof props.description === 'string' ? props.description : ''
      const titleHtml = title ? `<h3 class="jr-card-title">${escapeHtml(title)}</h3>` : ''
      const descriptionHtml = description ? `<p class="jr-card-description">${escapeHtml(description)}</p>` : ''
      return `<section class="jr-card">${titleHtml}${descriptionHtml}<div class="jr-card-content">${children}</div></section>`
    }
    case 'Heading': {
      const level = typeof props.level === 'string' && ['h1', 'h2', 'h3', 'h4'].includes(props.level)
        ? props.level
        : 'h3'
      const text = typeof props.text === 'string' ? props.text : ''
      return `<${level} class="jr-heading">${escapeHtml(text)}</${level}>`
    }
    case 'Text': {
      const content = typeof props.content === 'string' ? props.content : ''
      const className = props.muted === true ? 'jr-text jr-text-muted' : 'jr-text'
      return `<p class="${className}">${escapeHtml(content)}</p>`
    }
    case 'Badge': {
      const text = typeof props.text === 'string' ? props.text : ''
      const variant = typeof props.variant === 'string' ? props.variant : 'default'
      return `<span class="jr-badge jr-badge-${escapeHtml(variant)}">${escapeHtml(text)}</span>`
    }
    case 'Separator':
      return '<hr class="jr-separator" />'
    case 'Metric': {
      const label = typeof props.label === 'string' ? props.label : ''
      const value = typeof props.value === 'string' ? props.value : ''
      const detail = typeof props.detail === 'string' ? props.detail : ''
      const trend = typeof props.trend === 'string' ? props.trend : 'neutral'
      const trendArrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '•'
      return `
<article class="jr-metric">
  <div class="jr-metric-label">${escapeHtml(label)}</div>
  <div class="jr-metric-value">${escapeHtml(value)}</div>
  <div class="jr-metric-detail">${escapeHtml(trendArrow)} ${escapeHtml(detail)}</div>
</article>`
    }
    case 'LineChart':
      return renderLineChart(props)
    case 'BarChart':
      return renderBarChart(props)
    case 'Table': {
      const columns = toColumns(props.columns)
      const rows = toRows(props.data)
      const emptyMessage = typeof props.emptyMessage === 'string' ? props.emptyMessage : 'No rows to display.'
      if (columns.length === 0 || rows.length === 0) {
        return `<div class="jr-table-empty">${escapeHtml(emptyMessage)}</div>`
      }
      const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')
      const body = rows.map((row) => {
        const cells = columns.map((column) => `<td>${escapeHtml(toDisplay(row[column.key]))}</td>`).join('')
        return `<tr>${cells}</tr>`
      }).join('')
      return `
<div class="jr-table-wrap">
  <table class="jr-table">
    <thead><tr>${header}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>`
    }
    case 'Alert': {
      const tone = typeof props.tone === 'string' ? props.tone : 'info'
      const title = typeof props.title === 'string' ? props.title : ''
      const message = typeof props.message === 'string' ? props.message : ''
      return `<section class="jr-alert jr-alert-${escapeHtml(tone)}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></section>`
    }
    case 'Callout': {
      const type = typeof props.type === 'string' ? props.type : 'info'
      const title = typeof props.title === 'string' ? props.title : ''
      const content = typeof props.content === 'string' ? props.content : ''
      const heading = title ? `<strong>${escapeHtml(title)}</strong>` : ''
      return `<section class="jr-callout jr-callout-${escapeHtml(type)}">${heading}<p>${escapeHtml(content)}</p></section>`
    }
    case 'Accordion': {
      const items = Array.isArray(props.items) ? props.items : []
      const details = items.flatMap((item) => {
        if (!isRecord(item)) return []
        const title = typeof item.title === 'string' ? item.title : ''
        const content = typeof item.content === 'string' ? item.content : ''
        return [`<details class="jr-accordion-item"><summary>${escapeHtml(title)}</summary><p>${escapeHtml(content)}</p></details>`]
      }).join('')
      return `<section class="jr-accordion">${details}</section>`
    }
    case 'Input': {
      const label = typeof props.label === 'string' ? props.label : ''
      const value = typeof props.value === 'string' ? props.value : ''
      const placeholder = typeof props.placeholder === 'string' ? props.placeholder : ''
      const labelHtml = label ? `<label class="jr-input-label">${escapeHtml(label)}</label>` : ''
      return `${labelHtml}<input class="jr-input" disabled value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />`
    }
    case 'Select': {
      const label = typeof props.label === 'string' ? props.label : ''
      const selectedValue = typeof props.value === 'string' ? props.value : ''
      const options = Array.isArray(props.options) ? props.options : []
      const optionHtml = options.flatMap((option) => {
        if (!isRecord(option)) return []
        if (typeof option.value !== 'string') return []
        const optionLabel = typeof option.label === 'string' ? option.label : option.value
        const selected = option.value === selectedValue ? ' selected' : ''
        return [`<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(optionLabel)}</option>`]
      }).join('')
      const labelHtml = label ? `<label class="jr-input-label">${escapeHtml(label)}</label>` : ''
      return `${labelHtml}<select class="jr-input" disabled>${optionHtml}</select>`
    }
    case 'RadioGroup': {
      const label = typeof props.label === 'string' ? props.label : ''
      const selectedValue = typeof props.value === 'string' ? props.value : ''
      const options = Array.isArray(props.options) ? props.options : []
      const optionsHtml = options.flatMap((option) => {
        if (!isRecord(option)) return []
        if (typeof option.value !== 'string') return []
        const optionLabel = typeof option.label === 'string' ? option.label : option.value
        const checked = option.value === selectedValue ? ' checked' : ''
        return [`<label class="jr-radio"><input type="radio" disabled${checked} /><span>${escapeHtml(optionLabel)}</span></label>`]
      }).join('')
      const labelHtml = label ? `<label class="jr-input-label">${escapeHtml(label)}</label>` : ''
      return `${labelHtml}<div class="jr-radio-group">${optionsHtml}</div>`
    }
    case 'Switch': {
      const label = typeof props.label === 'string' ? props.label : ''
      const checked = props.checked === true
      const stateLabel = checked ? 'On' : 'Off'
      return `<label class="jr-switch">${escapeHtml(label)} <span class="jr-switch-pill">${escapeHtml(stateLabel)}</span></label>`
    }
    case 'Button': {
      const label = typeof props.label === 'string' ? props.label : 'Button'
      return `<button class="jr-button" disabled>${escapeHtml(label)}</button>`
    }
    default:
      return `<div class="jr-warning">Unsupported component: ${escapeHtml(String(element.type))}</div>`
  }
}

const buildStyles = (): string => `
:root {
  color-scheme: dark;
  --bg: #ffffff;
  --text: #0f172a;
  --muted: #475569;
  --panel: #f8fafc;
  --panel-border: #dbe3f0;
  --accent: #2563eb;
  --ok: #128a49;
  --warn: #a45800;
  --danger: #ba1f2f;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  color: var(--text);
  background: var(--bg);
}

.jr-stack { min-width: 0; }
.jr-grid { min-width: 0; }
.jr-card {
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: var(--panel);
  padding: 12px;
}
.jr-card-title {
  margin: 0 0 5px;
  font-size: 14px;
}
.jr-card-description {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 12px;
}
.jr-card-content { min-width: 0; }

.jr-heading {
  margin: 0 0 6px;
  line-height: 1.2;
}
.jr-text {
  margin: 0;
  line-height: 1.45;
}
.jr-text-muted {
  color: var(--muted);
}
.jr-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  background: #e2e8f0;
}
.jr-badge-success { background: #dcfce7; color: #14532d; }
.jr-badge-warning { background: #fef3c7; color: #78350f; }
.jr-badge-danger { background: #fee2e2; color: #7f1d1d; }

.jr-separator {
  border: none;
  border-top: 1px solid var(--panel-border);
  margin: 6px 0;
}

.jr-metric {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: white;
  padding: 10px;
}
.jr-metric-label {
  font-size: 12px;
  color: var(--muted);
}
.jr-metric-value {
  margin-top: 4px;
  font-size: 24px;
  font-weight: 700;
}
.jr-metric-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.jr-chart {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: white;
  padding: 10px;
}
.jr-chart-title {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}
.jr-chart-line svg {
  width: 100%;
  height: 140px;
  color: var(--accent);
}
.jr-chart-labels {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(50px, 1fr));
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}
.jr-bar-list {
  display: grid;
  gap: 8px;
}
.jr-bar-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) 3fr auto;
  gap: 8px;
  align-items: center;
}
.jr-bar-track {
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
  min-height: 10px;
}
.jr-bar-fill {
  height: 10px;
  background: var(--accent);
}
.jr-bar-label, .jr-bar-value {
  font-size: 12px;
  color: var(--muted);
}
.jr-chart-empty {
  font-size: 12px;
  color: var(--muted);
}

.jr-table-wrap {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  overflow: auto;
}
.jr-table {
  width: 100%;
  border-collapse: collapse;
}
.jr-table th,
.jr-table td {
  border-bottom: 1px solid var(--panel-border);
  padding: 8px;
  text-align: left;
  font-size: 12px;
}
.jr-table th {
  background: #f1f5f9;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.jr-table-empty {
  font-size: 12px;
  color: var(--muted);
}

.jr-alert,
.jr-callout {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  padding: 10px;
}
.jr-alert p,
.jr-callout p {
  margin: 4px 0 0;
}
.jr-alert-warning, .jr-callout-warning { border-color: #f59e0b; background: #fffbeb; color: #7c2d12; }
.jr-alert-danger, .jr-callout-important { border-color: #ef4444; background: #fef2f2; color: #7f1d1d; }
.jr-alert-success { border-color: #22c55e; background: #f0fdf4; color: #14532d; }
.jr-alert-info, .jr-callout-info, .jr-callout-tip { border-color: #60a5fa; background: #eff6ff; color: #1e3a8a; }

.jr-accordion {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  overflow: hidden;
}
.jr-accordion-item + .jr-accordion-item {
  border-top: 1px solid var(--panel-border);
}
.jr-accordion-item summary {
  cursor: pointer;
  padding: 8px 10px;
  font-weight: 600;
}
.jr-accordion-item p {
  margin: 0;
  padding: 0 10px 10px;
  color: var(--muted);
}

.jr-input-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--muted);
}
.jr-input {
  width: 100%;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  background: white;
  color: var(--text);
}
.jr-radio-group {
  display: grid;
  gap: 6px;
}
.jr-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.jr-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.jr-switch-pill {
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  padding: 2px 7px;
}
.jr-button {
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 7px 12px;
  background: #f8fafc;
  color: var(--text);
  font-size: 12px;
}

.jr-warning {
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  background: #fef9c3;
  color: #854d0e;
}
`

const wrapAsDocument = (body: string, title: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>${buildStyles()}</style>
  </head>
  <body>${body}</body>
</html>
`

export const renderSpecToHtml = ({ title, spec, state }: RenderHtmlInput): string => {
  const root = renderElement(spec.root, spec.elements, state, new Set(), 0)
  return wrapAsDocument(root, title)
}
