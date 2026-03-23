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
  extractToolNames,
  loadJsonFile,
  syncDatasetItems,
  toCaseInput,
} from './lib/index.js'

const DATASET_PATH = resolve('experiments/datasets/tool-use.synthetic.json')
const DATASET_NAME = '03_01_evals/tool-use-synthetic'

// ============================================================================
// Dataset shape
// ============================================================================

interface ToolUseExpect {
  shouldUseTools: boolean
  requiredTools: string[]
  forbiddenTools?: string[]
  minToolCalls?: number
  maxToolCalls?: number
}

interface ToolUseCase {
  id: string
  message: string
  expect: ToolUseExpect
}

const parseDataset = (raw: unknown): ToolUseCase[] =>
  asArray(raw).flatMap((item): ToolUseCase[] => {
    if (typeof item !== 'object' || item === null) {
      return []
    }

    const c = item as {
      id?: unknown
      message?: unknown
      expect?: {
        shouldUseTools?: unknown
        requiredTools?: unknown
        forbiddenTools?: unknown
        minToolCalls?: unknown
        maxToolCalls?: unknown
      }
    }

    if (typeof c.id !== 'string' || typeof c.message !== 'string' || typeof c.expect?.shouldUseTools !== 'boolean') {
      return []
    }

    const requiredTools = asArray(c.expect.requiredTools).filter((v): v is string => typeof v === 'string')
    const forbiddenTools = asArray(c.expect.forbiddenTools).filter((v): v is string => typeof v === 'string')

    return [{
      id: c.id,
      message: c.message,
      expect: {
        shouldUseTools: c.expect.shouldUseTools,
        requiredTools,
        ...(forbiddenTools.length > 0 ? { forbiddenTools } : {}),
        ...(typeof c.expect.minToolCalls === 'number' ? { minToolCalls: c.expect.minToolCalls } : {}),
        ...(typeof c.expect.maxToolCalls === 'number' ? { maxToolCalls: c.expect.maxToolCalls } : {}),
      },
    }]
  })

const toSeeds = (cases: ToolUseCase[]): DatasetItemSeed[] =>
  cases.map((item) => ({
    id: `03_01_evals_tool_use_${item.id}`,
    input: { id: item.id, message: item.message },
    expectedOutput: item.expect,
    metadata: { source: 'synthetic', caseId: item.id },
  }))

// ============================================================================
// Evaluation logic (experiment-specific)
// ============================================================================

const toExpected = (raw: unknown): ToolUseExpect => {
  if (typeof raw !== 'object' || raw == null) {
    return { shouldUseTools: false, requiredTools: [], maxToolCalls: 0 }
  }

  const c = raw as {
    shouldUseTools?: unknown
    requiredTools?: unknown
    forbiddenTools?: unknown
    minToolCalls?: unknown
    maxToolCalls?: unknown
  }

  const requiredTools = asArray(c.requiredTools).filter((v): v is string => typeof v === 'string')
  const forbiddenTools = asArray(c.forbiddenTools).filter((v): v is string => typeof v === 'string')

  return {
    shouldUseTools: typeof c.shouldUseTools === 'boolean' ? c.shouldUseTools : false,
    requiredTools,
    ...(forbiddenTools.length > 0 ? { forbiddenTools } : {}),
    ...(typeof c.minToolCalls === 'number' ? { minToolCalls: c.minToolCalls } : {}),
    ...(typeof c.maxToolCalls === 'number' ? { maxToolCalls: c.maxToolCalls } : {}),
  }
}

const toolUseEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const inputCase = toCaseInput(input)
  const expected = toExpected(expectedOutput)
  const outputObj = (typeof output === 'object' && output != null ? output : {}) as { toolNames?: unknown }
  const toolNames = asArray(outputObj.toolNames).filter((v): v is string => typeof v === 'string')

  const count = toolNames.length
  const unique = new Set(toolNames)

  const decision = expected.shouldUseTools ? (count > 0 ? 1 : 0) : (count === 0 ? 1 : 0)
  const required = expected.requiredTools.length === 0 ? 1 : (expected.requiredTools.every((n) => unique.has(n)) ? 1 : 0)
  const forbidden = (expected.forbiddenTools ?? []).length === 0 ? 1 : ((expected.forbiddenTools ?? []).every((n) => !unique.has(n)) ? 1 : 0)
  const callCount = (expected.minToolCalls === undefined || count >= expected.minToolCalls) && (expected.maxToolCalls === undefined || count <= expected.maxToolCalls) ? 1 : 0
  const overall = (decision + required + forbidden + callCount) / 4

  return [
    { name: 'tool_use_overall', value: overall, comment: `[${inputCase.id}] tools=[${toolNames.join(', ')}]` },
    { name: 'tool_use_decision_accuracy', value: decision },
    { name: 'tool_use_required_tools_accuracy', value: required },
    { name: 'tool_use_forbidden_tools_accuracy', value: forbidden },
    { name: 'tool_use_call_count_accuracy', value: callCount },
  ]
}

// ============================================================================
// Task
// ============================================================================

const buildTask = (ctx: Awaited<ReturnType<typeof bootstrap>>): ExperimentTask =>
  async (item) => {
    const inputCase = toCaseInput(item.input)
    const session: Session = { id: `eval-${inputCase.id}-${Date.now()}`, messages: [] }

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
      toolCalls: extractToolNames(session.messages).length,
      toolNames: extractToolNames(session.messages),
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
    name: 'Tool Use Eval',
    datasetCases: cases.length,
    description: 'Sprawdza, czy agent poprawnie wybiera i wywołuje narzędzia (get_current_time, sum_numbers) dla syntetycznych przypadków testowych.',
  })

  const ctx = await bootstrap({ experimentName: 'tool_use' })

  try {

    await ensureDataset(ctx.langfuse, {
      name: DATASET_NAME,
      description: 'Synthetic tool-use evaluation dataset',
      metadata: { source: DATASET_PATH, kind: 'synthetic', domain: 'tool-use' },
    }, ctx.logger)

    await syncDatasetItems(ctx.langfuse, DATASET_NAME, toSeeds(cases), ctx.logger)

    const dataset = await ctx.langfuse.dataset.get(DATASET_NAME)
    const result = await dataset.runExperiment({
      name: '03_01 Tool Use Eval',
      description: 'Synthetic evaluation of tool selection and usage quality',
      metadata: {
        datasetName: DATASET_NAME,
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      },
      task: buildTask(ctx),
      evaluators: [toolUseEvaluator],
      runEvaluators: [createAvgScoreEvaluator('tool_use_overall')],
      maxConcurrency: 2,
    })

    console.log(await result.format({ includeItemResults: true }))
  } finally {
    await ctx.shutdown()
  }
}

main().catch((error) => {
  console.error('Tool-use eval failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
