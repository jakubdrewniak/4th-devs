import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RenderPackId } from '../types.js'

type DatasetFormat = 'csv' | 'json'

interface DemoDatasetFixture {
  filename: string
  title: string
  objective: string
  format: DatasetFormat
  suggestedPacks: RenderPackId[]
  content: string
}

export interface SeededDemoDataset {
  filename: string
  title: string
  objective: string
  format: DatasetFormat
  suggestedPacks: RenderPackId[]
  path: string
}

export interface LoadedDemoDataset extends SeededDemoDataset {
  content: string
}

const DATASET_DIR = join(process.cwd(), 'workspace', 'datasets')

const FIXTURES: DemoDatasetFixture[] = [
  {
    filename: 'revenue-by-month.csv',
    title: 'Monthly Revenue by Channel',
    objective: 'Reveal seasonality and channel efficiency over time.',
    format: 'csv',
    suggestedPacks: ['analytics-core', 'analytics-viz', 'analytics-table', 'analytics-insight'],
    content: [
      'month,channel,revenue_usd,target_usd,marketing_spend_usd,refunds_usd',
      '2025-01,organic,182000,175000,12000,3200',
      '2025-01,paid,141000,150000,42000,5400',
      '2025-01,partner,99000,92000,7000,2100',
      '2025-02,organic,176000,178000,11800,2900',
      '2025-02,paid,149000,152000,43000,5100',
      '2025-02,partner,103000,94000,7600,1900',
      '2025-03,organic,191000,185000,12500,3400',
      '2025-03,paid,156000,158000,44500,5700',
      '2025-03,partner,108000,98000,7800,2200',
      '2025-04,organic,204000,192000,13000,3600',
      '2025-04,paid,162000,161000,46200,6200',
      '2025-04,partner,113000,101000,8100,2400',
      '2025-05,organic,216000,198000,13800,3900',
      '2025-05,paid,171000,166000,47000,6600',
      '2025-05,partner,121000,106000,8500,2600',
      '2025-06,organic,227000,205000,14200,4100',
      '2025-06,paid,178000,171000,48200,6900',
      '2025-06,partner,127000,110000,8800,2800',
      '',
    ].join('\n'),
  },
  {
    filename: 'sales-activities.csv',
    title: 'Sales Team Weekly Activity',
    objective: 'Compare rep effort versus outcomes and conversion quality.',
    format: 'csv',
    suggestedPacks: ['analytics-core', 'analytics-viz', 'analytics-table', 'analytics-insight'],
    content: [
      'week,rep,calls,emails,meetings,demos,won_deals,lost_deals,pipeline_usd',
      '2025-W20,Ada,148,214,17,9,3,2,194000',
      '2025-W20,Noah,121,188,14,7,2,3,156000',
      '2025-W20,Mila,134,205,16,8,4,1,213000',
      '2025-W20,Liam,109,176,12,6,1,3,127000',
      '2025-W21,Ada,152,220,18,10,4,2,207000',
      '2025-W21,Noah,116,180,13,6,2,4,149000',
      '2025-W21,Mila,141,212,17,9,3,2,221000',
      '2025-W21,Liam,113,184,12,7,2,2,136000',
      '2025-W22,Ada,157,229,18,11,4,1,219000',
      '2025-W22,Noah,119,186,14,7,2,3,161000',
      '2025-W22,Mila,146,218,18,9,4,1,233000',
      '2025-W22,Liam,118,191,13,8,2,2,143000',
      '',
    ].join('\n'),
  },
  {
    filename: 'pipeline-funnel.json',
    title: 'Pipeline Funnel Snapshot',
    objective: 'Highlight where deal volume and value drop in the funnel.',
    format: 'json',
    suggestedPacks: ['analytics-core', 'analytics-viz', 'analytics-table', 'analytics-insight'],
    content: JSON.stringify(
      {
        generatedAt: '2025-06-30T12:00:00Z',
        quarter: '2025-Q2',
        stages: [
          { stage: 'Lead', deals: 1240, valueUsd: 11800000, conversionToNext: 0.58 },
          { stage: 'Qualified', deals: 719, valueUsd: 9240000, conversionToNext: 0.52 },
          { stage: 'Discovery', deals: 374, valueUsd: 7010000, conversionToNext: 0.47 },
          { stage: 'Proposal', deals: 176, valueUsd: 4620000, conversionToNext: 0.43 },
          { stage: 'Negotiation', deals: 76, valueUsd: 2410000, conversionToNext: 0.57 },
          { stage: 'Closed Won', deals: 43, valueUsd: 1710000, conversionToNext: 1 },
        ],
      },
      null,
      2,
    ),
  },
  {
    filename: 'customer-retention.json',
    title: 'Cohort Retention and Expansion',
    objective: 'Compare retention curves and expansion behavior across cohorts.',
    format: 'json',
    suggestedPacks: ['analytics-core', 'analytics-viz', 'analytics-table', 'analytics-insight'],
    content: JSON.stringify(
      {
        cohorts: [
          { cohort: '2025-01', m0: 1, m1: 0.91, m2: 0.86, m3: 0.82, m4: 0.79, m5: 0.77, expansionRate: 0.11 },
          { cohort: '2025-02', m0: 1, m1: 0.93, m2: 0.88, m3: 0.84, m4: 0.8, m5: 0.78, expansionRate: 0.13 },
          { cohort: '2025-03', m0: 1, m1: 0.89, m2: 0.83, m3: 0.79, m4: 0.75, m5: 0.72, expansionRate: 0.09 },
          { cohort: '2025-04', m0: 1, m1: 0.94, m2: 0.9, m3: 0.86, m4: 0.83, m5: 0.81, expansionRate: 0.16 },
        ],
      },
      null,
      2,
    ),
  },
]

const randomIndex = (size: number): number => Math.floor(Math.random() * size)

const toSeeded = (fixture: DemoDatasetFixture): SeededDemoDataset => ({
  filename: fixture.filename,
  title: fixture.title,
  objective: fixture.objective,
  format: fixture.format,
  suggestedPacks: fixture.suggestedPacks,
  path: join(DATASET_DIR, fixture.filename),
})

export const ensureDemoDatasets = async (): Promise<SeededDemoDataset[]> => {
  await mkdir(DATASET_DIR, { recursive: true })
  await Promise.all(
    FIXTURES.map(async (fixture) => {
      const path = join(DATASET_DIR, fixture.filename)
      await writeFile(path, fixture.content.endsWith('\n') ? fixture.content : `${fixture.content}\n`, 'utf-8')
    }),
  )
  return FIXTURES.map(toSeeded)
}

export const chooseDemoDataset = async (
  seeded: SeededDemoDataset[],
  filenameOverride?: string,
): Promise<LoadedDemoDataset> => {
  if (seeded.length === 0) {
    throw new Error('No demo datasets available.')
  }

  const requested = filenameOverride?.trim()
  const selected = requested
    ? seeded.find((dataset) => dataset.filename === requested)
    : seeded[randomIndex(seeded.length)]

  if (!selected) {
    throw new Error(`Requested demo dataset not found: ${requested}`)
  }

  const content = await readFile(selected.path, 'utf-8')
  return {
    ...selected,
    content,
  }
}

export const buildDemoRenderPrompt = (
  dataset: LoadedDemoDataset,
  allDatasetNames: string[],
): string => {
  const fence = dataset.format
  return [
    'Demo mode: component-guardrailed dataset rendering challenge.',
    'You are given multiple possible dataset files, but only ONE is selected for this run.',
    `All available files: ${allDatasetNames.join(', ')}`,
    `Selected file for this run: ${dataset.filename}`,
    '',
    'Task:',
    '1) Parse the selected dataset content.',
    '2) Generate one static analytics dashboard spec with realistic derived metrics.',
    '3) Include: section heading, at least 3 metrics, one chart, one table, and one insight callout.',
    '4) Keep component usage concise and data-first.',
    '5) Keep output strictly in the allowed render payload JSON shape.',
    '',
    `Dataset objective: ${dataset.objective}`,
    '',
    `Selected dataset content (${dataset.filename}):`,
    `\`\`\`${fence}`,
    dataset.content.trim(),
    '```',
    '',
    'Build the render document now.',
  ].join('\n')
}
