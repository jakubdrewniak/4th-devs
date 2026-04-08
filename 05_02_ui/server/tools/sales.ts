import { randomUUID } from 'node:crypto'
import { PRODUCT_ROWS } from '../data/products'
import type { RegisteredTool } from './types'
import { asChartRows, asNumber, asString, createChartPreview, persistFile, slugify } from './shared'

export const getSalesReportTool: RegisteredTool = {
  definition: {
    name: 'get_sales_report',
    description: 'Return mocked monthly sales data for the requested period.',
    parameters: {
      type: 'object',
      properties: {
        granularity: { type: 'string', enum: ['monthly'] },
        period: { type: 'string', description: 'Month in YYYY-MM format.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  async handle(args) {
    const limit = Math.max(1, Math.min(10, Math.trunc(asNumber(args.limit, 3))))
    const period = asString(args.period, '2026-02')
    const granularity = asString(args.granularity, 'monthly') || 'monthly'
    const rows = PRODUCT_ROWS.slice(0, limit)

    return {
      output: {
        granularity,
        period,
        rows,
      },
    }
  },
}

export const renderChartTool: RegisteredTool = {
  definition: {
    name: 'render_chart',
    description: 'Render a mocked chart artifact as a local markdown file.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        chartType: { type: 'string', enum: ['bar', 'table'], description: 'Visual style for the mock chart.' },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              note: { type: 'string' },
            },
            required: ['label', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'rows'],
      additionalProperties: false,
    },
  },
  async handle(args, ctx) {
    const title = asString(args.title, 'Chart')
    const rows = asChartRows(args.rows)
    const preview = createChartPreview(title, rows)
    const relativePath = `artifacts/${slugify(title)}-${randomUUID().slice(0, 8)}.md`
    const savedPath = await persistFile(ctx.dataDir, relativePath, preview)

    return {
      output: {
        artifactPath: savedPath,
        kind: 'markdown',
        chartType: asString(args.chartType, 'bar') || 'bar',
        rowCount: rows.length,
      },
      artifacts: [{
        kind: 'markdown',
        title,
        description: 'Mock chart artifact rendered from tool data.',
        path: savedPath,
        preview,
      }],
    }
  },
}
