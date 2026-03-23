import type OpenAI from 'openai'

export const TOOL_DEFINITIONS: OpenAI.Responses.FunctionTool[] = [
  {
    type: 'function',
    name: 'get_current_time',
    description: 'Returns current UTC time in ISO format.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'sum_numbers',
    description: 'Sums a list of numbers.',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
        },
      },
      required: ['numbers'],
      additionalProperties: false,
    },
    strict: false,
  },
]

interface ToolArgs {
  numbers?: number[]
}

const parseArgs = (raw: string): { ok: true; value: ToolArgs } | { ok: false; error: string } => {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null) {
      return { ok: false, error: `Expected object, got ${typeof parsed}` }
    }
    return { ok: true, value: parsed as ToolArgs }
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export const executeTool = async (
  name: string,
  rawArgs: string,
): Promise<string> => {
  if (name === 'get_current_time') {
    return JSON.stringify({ nowUtc: new Date().toISOString() })
  }

  if (name === 'sum_numbers') {
    const result = parseArgs(rawArgs)
    if (!result.ok) {
      return JSON.stringify({ error: result.error })
    }

    const numbers = Array.isArray(result.value.numbers)
      ? result.value.numbers.filter((n) => Number.isFinite(n))
      : []

    if (numbers.length === 0) {
      return JSON.stringify({ error: 'numbers must contain at least one numeric value' })
    }

    const sum = numbers.reduce((acc, value) => acc + value, 0)
    return JSON.stringify({ count: numbers.length, sum })
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` })
}
