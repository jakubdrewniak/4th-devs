import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../../config.js'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS })
const TRACE_DIR = join(process.cwd(), 'workspace', 'traces')

const ensureTraceDir = async (): Promise<void> => {
  await mkdir(TRACE_DIR, { recursive: true })
}

const traceFile = (): string => {
  const stamp = new Date().toISOString().slice(0, 10)
  return join(TRACE_DIR, `${stamp}.jsonl`)
}

const appendTrace = async (label: string, entry: Record<string, unknown>): Promise<void> => {
  await ensureTraceDir()
  const line = JSON.stringify({ ts: new Date().toISOString(), label, ...entry })
  await appendFile(traceFile(), `${line}\n`, 'utf-8').catch(() => undefined)
}

export interface RunResponsesToolLoopParams {
  model: string
  instructions: string
  tools?: OpenAI.Responses.Tool[]
  initialInput: string | OpenAI.Responses.ResponseInput
  previousResponseId?: string
  maxTurns: number
  reasoning?: OpenAI.Reasoning | null
  parallelToolCalls?: boolean
  traceLabel?: string
  onTurnStart?: (context: {
    turn: number
    inputItems: number
    hasPreviousResponseId: boolean
  }) => void
  executeTool: (call: OpenAI.Responses.ResponseFunctionToolCall) => Promise<string>
}

export interface RunResponsesToolLoopResult {
  text: string
  usedTool: boolean
  fromModel: boolean
  lastResponseId?: string
}

const extractFunctionCalls = (
  response: OpenAI.Responses.Response,
): OpenAI.Responses.ResponseFunctionToolCall[] =>
  response.output.filter(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
  )

export const runResponsesToolLoop = async (
  params: RunResponsesToolLoopParams,
): Promise<RunResponsesToolLoopResult> => {
  let previousResponseId = params.previousResponseId
  let pendingInput = params.initialInput
  let usedTool = false

  for (let turn = 0; turn < params.maxTurns; turn += 1) {
    const inputItems = Array.isArray(pendingInput) ? pendingInput.length : 1
    params.onTurnStart?.({
      turn: turn + 1,
      inputItems,
      hasPreviousResponseId: Boolean(previousResponseId),
    })

    const tag = params.traceLabel ?? 'loop'

    await appendTrace(`${tag}.request`, {
      turn: turn + 1,
      model: params.model,
      previousResponseId,
      input: pendingInput,
    })

    const response = await openai.responses.create({
      model: params.model,
      instructions: params.instructions,
      previous_response_id: previousResponseId,
      input: pendingInput,
      tools: params.tools && params.tools.length > 0 ? params.tools : undefined,
      reasoning: params.reasoning,
      parallel_tool_calls: params.parallelToolCalls,
    })

    previousResponseId = response.id

    await appendTrace(`${tag}.response`, {
      turn: turn + 1,
      responseId: response.id,
      status: response.status,
      outputItems: response.output.map((item) => ({
        type: item.type,
        ...(item.type === 'function_call'
          ? { name: (item as OpenAI.Responses.ResponseFunctionToolCall).name, arguments: (item as OpenAI.Responses.ResponseFunctionToolCall).arguments }
          : {}),
        ...(item.type === 'message'
          ? { text: (item as OpenAI.Responses.ResponseOutputMessage).content?.map((c) => ('text' in c ? c.text : c.type)) }
          : {}),
      })),
      outputText: response.output_text,
      error: response.error,
    })

    if (response.error) {
      return {
        text: response.error.message,
        usedTool,
        fromModel: false,
        lastResponseId: previousResponseId,
      }
    }

    const calls = extractFunctionCalls(response)
    if (calls.length === 0) {
      return {
        text: response.output_text ?? '',
        usedTool,
        fromModel: true,
        lastResponseId: previousResponseId,
      }
    }

    usedTool = true
    const toolOutputs: OpenAI.Responses.ResponseInput = []
    for (const call of calls) {
      const output = await params.executeTool(call)
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output,
      })

      await appendTrace(`${tag}.toolResult`, {
        turn: turn + 1,
        callId: call.call_id,
        toolName: call.name,
        outputLength: output.length,
        outputPreview: output.slice(0, 500),
      })
    }

    if (toolOutputs.length === 0) {
      return {
        text: 'No response from model.',
        usedTool,
        fromModel: false,
        lastResponseId: previousResponseId,
      }
    }

    pendingInput = toolOutputs
  }

  return {
    text: 'Reached maximum turns.',
    usedTool,
    fromModel: false,
    lastResponseId: previousResponseId,
  }
}
