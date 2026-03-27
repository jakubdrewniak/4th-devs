import OpenAI from 'openai'
import { ENV } from '../config.js'
import type {
  AgentTurnResult,
  GenerateRenderProgress,
  RenderDocument,
} from '../types.js'
import { generateRenderDocument } from './spec-generator.js'

interface RunAgentTurnOptions {
  currentDocument?: RenderDocument | null
  onProgress?: (progress: GenerateRenderProgress) => void
}

const emitProgress = (options: RunAgentTurnOptions, progress: GenerateRenderProgress): void => {
  options.onProgress?.(progress)
}

const openai = ENV.apiKey.trim().length > 0
  ? new OpenAI({ apiKey: ENV.apiKey, baseURL: ENV.baseURL, defaultHeaders: ENV.defaultHeaders })
  : null

interface CreateRenderToolInput {
  prompt?: string
  packs?: string[]
}

interface EditRenderToolInput {
  instructions?: string
  packs?: string[]
}

type KnownToolName = 'create_render' | 'edit_render'

const ROUTER_INSTRUCTIONS = [
  'You are a CLI render agent with two optional tools: create_render and edit_render.',
  'Use create_render for requests to build/generate/create dashboards, reports, specs, layouts, or visualized data views.',
  'Use edit_render for requests to modify/refine/update the current rendered document.',
  'For normal questions, greetings, or non-render tasks, do NOT call tools and respond conversationally.',
  'If the user request is ambiguous, ask a concise clarifying question instead of calling tools.',
  'Prefer the minimal set of packs needed to satisfy the request.',
  'Keep responses concise and practical.',
].join('\n')

const createRenderTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'create_render',
  description: 'Generate a component-guardrailed render document (spec + state).',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The user intent for generating the render document.',
      },
      packs: {
        type: 'array',
        description: 'Optional preferred packs to use.',
        items: { type: 'string' },
      },
    },
    required: ['prompt'],
  },
}

const editRenderTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'edit_render',
  description: 'Modify the currently rendered document with new instructions.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      instructions: {
        type: 'string',
        description: 'What to change in the current document.',
      },
      packs: {
        type: 'array',
        description: 'Optional pack override for regenerated document.',
        items: { type: 'string' },
      },
    },
    required: ['instructions'],
  },
}

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const parseToolPacks = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const packs = value.filter((item): item is string => typeof item === 'string')
  return packs.length > 0 ? packs : undefined
}

const isKnownToolName = (value: string): value is KnownToolName =>
  value === 'create_render' || value === 'edit_render'

const extractKnownToolCall = (
  response: OpenAI.Responses.Response,
): (OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName }) | null =>
  response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName } =>
      item.type === 'function_call' && isKnownToolName(item.name),
  ) ?? null

const completeToolTurn = async (
  baseResponseId: string,
  callId: string,
  output: string,
): Promise<string> => {
  if (!openai) return ''
  const response = await openai.responses.create({
    model: ENV.model,
    reasoning: { effort: ENV.reasoningEffort },
    previous_response_id: baseResponseId,
    input: [{ type: 'function_call_output', call_id: callId, output }],
  })
  return response.output_text?.trim() ?? ''
}

const documentContextForRouter = (document: RenderDocument | null | undefined): string => {
  if (!document) {
    return 'Current document: none.'
  }

  const elementKeys = Object.keys(document.spec.elements)
  return [
    'Current document context:',
    `- id: ${document.id}`,
    `- title: ${document.title}`,
    `- packs: ${document.packs.join(', ') || 'none'}`,
    `- elements_count: ${elementKeys.length}`,
    `- root: ${document.spec.root}`,
    `- summary: ${document.summary ?? 'none'}`,
    `- sample_elements: ${elementKeys.slice(0, 8).join(', ')}`,
  ].join('\n')
}

const buildEditPrompt = (document: RenderDocument, instructions: string): string =>
  [
    'You are editing an existing component-guardrailed render document.',
    `Current title: ${document.title}`,
    `Current summary: ${document.summary ?? 'none'}`,
    `Current packs: ${document.packs.join(', ')}`,
    '',
    'Current spec:',
    '```json',
    JSON.stringify(document.spec, null, 2),
    '```',
    '',
    'Current state:',
    '```json',
    JSON.stringify(document.state, null, 2),
    '```',
    '',
    `Edit instructions: ${instructions}`,
    'Regenerate an updated render document that applies these changes while preserving coherence.',
  ].join('\n')

export const runAgentTurn = async (
  userMessage: string,
  options: RunAgentTurnOptions = {},
): Promise<AgentTurnResult> => {
  const prompt = userMessage.trim()
  if (!prompt) {
    return { kind: 'chat', text: 'Please type a prompt.' }
  }

  emitProgress(options, {
    phase: 'interpreting_request',
    message: 'Understanding request intent...',
  })

  if (!openai) {
    return {
      kind: 'chat',
      text: 'API key is missing. Set OPENAI_API_KEY or OPENROUTER_API_KEY for agent tool routing.',
    }
  }

  emitProgress(options, {
    phase: 'calling_model',
    message: 'Deciding whether this turn needs render tools...',
  })

  const currentDocument = options.currentDocument ?? null
  const firstResponse = await openai.responses.create({
    model: ENV.model,
    reasoning: { effort: ENV.reasoningEffort },
    instructions: ROUTER_INSTRUCTIONS,
    input: [`User message:\n${prompt}`, documentContextForRouter(currentDocument)].join('\n\n'),
    tools: [createRenderTool, editRenderTool],
    parallel_tool_calls: false,
  })

  const toolCall = extractKnownToolCall(firstResponse)
  if (!toolCall) {
    const text = firstResponse.output_text?.trim()
    return {
      kind: 'chat',
      text: text && text.length > 0
        ? text
        : 'I can chat, create render documents, and update the current one.',
    }
  }

  if (toolCall.name === 'create_render') {
    const parsed = parseJson<CreateRenderToolInput>(toolCall.arguments) ?? {}
    const requestedPrompt = typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0
      ? parsed.prompt.trim()
      : prompt
    const requestedPacks = parseToolPacks(parsed.packs)

    const document = await generateRenderDocument(
      { prompt: requestedPrompt, packs: requestedPacks },
      { onProgress: options.onProgress },
    )

    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: true,
        action: 'created',
        documentId: document.id,
        title: document.title,
        packs: document.packs,
      }),
    )

    return {
      kind: 'render',
      text: followup || `Generated "${document.title}" using packs: ${document.packs.join(', ')}.`,
      document,
    }
  }

  if (!currentDocument) {
    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: false,
        reason: 'No current document available to edit.',
      }),
    )
    return {
      kind: 'chat',
      text: followup || 'No current document to edit yet. Ask me to generate one first.',
    }
  }

  const parsedEdit = parseJson<EditRenderToolInput>(toolCall.arguments) ?? {}
  const instructions = typeof parsedEdit.instructions === 'string' && parsedEdit.instructions.trim().length > 0
    ? parsedEdit.instructions.trim()
    : prompt
  const requestedPacks = parseToolPacks(parsedEdit.packs) ?? currentDocument.packs

  const document = await generateRenderDocument(
    {
      prompt: buildEditPrompt(currentDocument, instructions),
      packs: requestedPacks,
    },
    { onProgress: options.onProgress },
  )

  const followup = await completeToolTurn(
    firstResponse.id,
    toolCall.call_id,
    JSON.stringify({
      ok: true,
      action: 'edited',
      documentId: document.id,
      title: document.title,
      packs: document.packs,
    }),
  )

  return {
    kind: 'render',
    text: followup || `Updated "${document.title}" using packs: ${document.packs.join(', ')}.`,
    document,
  }
}
