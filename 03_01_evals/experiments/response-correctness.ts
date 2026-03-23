import { resolve } from 'node:path'
import type { Evaluator, ExperimentTask } from '@langfuse/client'
import { runAgent } from '../src/agent/run.js'
import type { Session } from '../src/types.js'
import {
  type DatasetItemSeed,
  asArray,
  bootstrap,
  confirmExperiment,
  createAvgScoreEvaluator,
  ensureDataset,
  loadJsonFile,
  syncDatasetItems,
  toCaseInput,
} from './lib/index.js'

const DATASET_PATH = resolve('experiments/datasets/response-correctness.synthetic.json')
const DATASET_NAME = '03_01_evals/response-correctness-synthetic'

// ============================================================================
// Dataset shape
// ============================================================================

interface ExactNumberExpect {
  type: 'exact_number'
  value: number
  description: string
}

interface TimestampExpect {
  type: 'contains_iso_timestamp'
  description: string
}

interface RelevanceExpect {
  type: 'relevance'
  topic: string
  description: string
}

type CaseExpect = ExactNumberExpect | TimestampExpect | RelevanceExpect

interface CorrectnessCase {
  id: string
  message: string
  expect: CaseExpect
}

const parseDataset = (raw: unknown): CorrectnessCase[] =>
  asArray(raw).flatMap((item): CorrectnessCase[] => {
    if (typeof item !== 'object' || item === null) {
      return []
    }

    const c = item as { id?: unknown; message?: unknown; expect?: { type?: unknown } }

    if (typeof c.id !== 'string' || typeof c.message !== 'string' || typeof c.expect?.type !== 'string') {
      return []
    }

    return [item as CorrectnessCase]
  })

const toSeeds = (cases: CorrectnessCase[]): DatasetItemSeed[] =>
  cases.map((item) => ({
    id: `03_01_evals_rc_${item.id}`,
    input: { id: item.id, message: item.message },
    expectedOutput: item.expect,
    metadata: { source: 'synthetic', caseId: item.id },
  }))

// ============================================================================
// Scoring rules
// ============================================================================

const ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

const extractNumbers = (text: string): number[] => {
  const matches = text.match(/-?\d+(?:\.\d+)?/g)
  if (!matches) {
    return []
  }

  return matches.map(Number).filter(Number.isFinite)
}

const scoreExactNumber = (response: string, expected: number): { value: number; comment: string } => {
  const numbers = extractNumbers(response)
  const found = numbers.some((n) => Math.abs(n - expected) < 0.01)

  return found
    ? { value: 1, comment: `Found expected value ${expected} in response` }
    : { value: 0, comment: `Expected ${expected}, found numbers: [${numbers.join(', ')}]` }
}

const scoreTimestamp = (response: string): { value: number; comment: string } => {
  const match = ISO_PATTERN.test(response)

  return match
    ? { value: 1, comment: 'Response contains valid ISO timestamp' }
    : { value: 0, comment: 'No ISO timestamp found in response' }
}

const GREETING_PATTERNS = /\b(hello|hi|hey|howdy|greetings|good\s+(morning|afternoon|evening|day)|welcome)\b/i

const scoreRelevance = (response: string, topic: string): { value: number; comment: string } => {
  const topicLower = topic.toLowerCase()

  if (topicLower === 'greeting' || topicLower.includes('greeting')) {
    const isGreeting = GREETING_PATTERNS.test(response)
    return isGreeting
      ? { value: 1, comment: 'Response contains a greeting' }
      : { value: 0, comment: 'No greeting detected in response' }
  }

  const normalized = response.toLowerCase()
  const keywords = topicLower.split(/\s+/)
  const matched = keywords.filter((keyword) => normalized.includes(keyword))
  const hasAny = matched.length > 0

  if (hasAny) {
    return { value: 1, comment: `On-topic: matched [${matched.join(', ')}]` }
  }

  return { value: 0, comment: `Off-topic: expected keywords from "${topic}", matched none` }
}

// ============================================================================
// Evaluator
// ============================================================================

const toExpected = (raw: unknown): CaseExpect | null => {
  if (typeof raw !== 'object' || raw == null) {
    return null
  }

  const candidate = raw as { type?: unknown }

  if (candidate.type === 'exact_number') {
    return raw as ExactNumberExpect
  }

  if (candidate.type === 'contains_iso_timestamp') {
    return raw as TimestampExpect
  }

  if (candidate.type === 'relevance') {
    return raw as RelevanceExpect
  }

  return null
}

const correctnessEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const inputCase = toCaseInput(input)
  const expected = toExpected(expectedOutput)
  const response = typeof output === 'object' && output != null && 'response' in output
    ? String((output as { response: unknown }).response)
    : ''

  if (!expected) {
    return { name: 'response_correctness', value: 0, comment: 'Missing or invalid expectedOutput' }
  }

  const hasResponse = response.length > 0 ? 1 : 0

  if (expected.type === 'exact_number') {
    const { value, comment } = scoreExactNumber(response, expected.value)
    return [
      { name: 'response_correctness', value, comment: `[${inputCase.id}] ${comment}` },
      { name: 'has_response', value: hasResponse },
    ]
  }

  if (expected.type === 'contains_iso_timestamp') {
    const { value, comment } = scoreTimestamp(response)
    return [
      { name: 'response_correctness', value, comment: `[${inputCase.id}] ${comment}` },
      { name: 'has_response', value: hasResponse },
    ]
  }

  if (expected.type === 'relevance') {
    const { value, comment } = scoreRelevance(response, expected.topic)
    return [
      { name: 'response_correctness', value, comment: `[${inputCase.id}] ${comment}` },
      { name: 'has_response', value: hasResponse },
    ]
  }

  return { name: 'response_correctness', value: 0, comment: `Unknown expect type: ${(expected as { type: string }).type}` }
}

// ============================================================================
// Task
// ============================================================================

const buildTask = (ctx: Awaited<ReturnType<typeof bootstrap>>): ExperimentTask =>
  async (item) => {
    const inputCase = toCaseInput(item.input)
    const session: Session = { id: `eval-rc-${inputCase.id}-${Date.now()}`, messages: [] }

    const run = await runAgent({
      adapter: ctx.adapter,
      logger: ctx.logger,
      session,
      message: inputCase.message,
    })

    return {
      id: inputCase.id,
      message: inputCase.message,
      response: run.response,
      turns: run.turns,
      usageTotal: run.usage.total ?? 0,
    }
  }

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
  const fileResult = await loadJsonFile<unknown>(DATASET_PATH)
  if (!fileResult.ok) {
    throw new Error(`Dataset load failed: ${fileResult.error}`)
  }

  const cases = parseDataset(fileResult.value)
  if (cases.length === 0) {
    throw new Error('No valid cases in dataset')
  }

  await confirmExperiment({
    name: 'Response Correctness Eval',
    datasetCases: cases.length,
    description: 'Sprawdza poprawność odpowiedzi agenta: dokładne liczby, znaczniki czasu ISO, trafność tematyczną.',
  })

  const ctx = await bootstrap({ experimentName: 'response_correctness' })

  try {

    await ensureDataset(ctx.langfuse, {
      name: DATASET_NAME,
      description: 'Synthetic response-correctness evaluation dataset',
      metadata: { source: DATASET_PATH, kind: 'synthetic', domain: 'response-correctness' },
    }, ctx.logger)

    await syncDatasetItems(ctx.langfuse, DATASET_NAME, toSeeds(cases), ctx.logger)

    const dataset = await ctx.langfuse.dataset.get(DATASET_NAME)
    const result = await dataset.runExperiment({
      name: '03_01 Response Correctness Eval',
      description: 'Black-box evaluation: is the final answer factually correct?',
      metadata: {
        datasetName: DATASET_NAME,
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      },
      task: buildTask(ctx),
      evaluators: [correctnessEvaluator],
      runEvaluators: [createAvgScoreEvaluator('response_correctness')],
      maxConcurrency: 2,
    })

    console.log(await result.format({ includeItemResults: true }))
  } finally {
    await ctx.shutdown()
  }
}

main().catch((error) => {
  console.error('Response correctness eval failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
