import OpenAI from 'openai'
import { ENV } from '../config.js'
import { logger } from '../logger.js'
import { artifactPackIds, getCapabilityManifestForPrompt } from './capabilities.js'
import { editArtifactWithSearchReplace } from './artifact-editor.js'
import type {
  ArtifactDocument,
  AgentTurnResult,
  GenerateArtifactOptions,
  GenerateArtifactProgress,
  SearchReplaceOperation,
} from '../types.js'
import { generateArtifact } from './artifact-generator.js'

interface RunAgentTurnOptions {
  currentArtifact?: ArtifactDocument | null
  serverBaseUrl?: string
  onProgress?: (progress: GenerateArtifactProgress) => void
}

interface CreateArtifactToolInput {
  prompt?: string
  packs?: string[]
}

interface EditArtifactToolInput {
  instructions?: string
  replacements?: unknown
  title?: string
}

type KnownToolName = 'create_artifact' | 'edit_artifact'

const emitProgress = (options: RunAgentTurnOptions, progress: GenerateArtifactProgress): void => {
  options.onProgress?.(progress)
}

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const localChatFallback = (): string =>
  'I can chat, generate artifacts, and edit the current artifact with search/replace. Tell me what to build or edit.'

const openai = ENV.apiKey.trim().length > 0
  ? new OpenAI({ apiKey: ENV.apiKey, baseURL: ENV.baseURL, defaultHeaders: ENV.defaultHeaders })
  : null

const ROUTER_INSTRUCTIONS = [
  'You are a CLI agent with two optional tools: create_artifact and edit_artifact.',
  'Use create_artifact ONLY when the user explicitly asks you to build/generate/create a visual or interactive artifact.',
  'Use edit_artifact ONLY when the user asks to modify the currently rendered artifact.',
  'For greetings, small talk, or normal questions, DO NOT call tools and respond conversationally.',
  'If request is ambiguous, ask a concise clarifying question instead of calling tools.',
  'When using create_artifact, choose the minimal packs needed for the request.',
  'If user asks for Tailwind/utility-first styling, include the tailwind pack.',
  'When using edit_artifact, emit concrete search/replace operations. Avoid vague edits.',
  '',
  getCapabilityManifestForPrompt(),
  'Keep responses concise.',
].join('\n')

const artifactTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'create_artifact',
  description:
    'Generate a self-contained HTML artifact for immediate browser preview. Use only for explicit build/create/generate artifact requests.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The exact user intent for artifact generation.',
      },
      packs: {
        type: 'array',
        description: 'Optional capability packs to preload before rendering.',
        items: {
          type: 'string',
          enum: artifactPackIds,
        },
      },
    },
    required: ['prompt'],
  },
}

const editArtifactTool: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: 'edit_artifact',
  description:
    'Edit the currently rendered artifact by applying exact search/replace operations to existing HTML.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      instructions: {
        type: 'string',
        description: 'Short description of what should change.',
      },
      title: {
        type: 'string',
        description: 'Optional new artifact title after the edit.',
      },
      replacements: {
        type: 'array',
        description: 'Search/replace operations to apply in order.',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            replace: { type: 'string' },
            replaceAll: { type: 'boolean' },
            useRegex: { type: 'boolean' },
            caseSensitive: { type: 'boolean' },
            regexFlags: { type: 'string' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['instructions', 'replacements'],
  },
}

const isKnownToolName = (value: string): value is KnownToolName =>
  value === 'create_artifact' || value === 'edit_artifact'

const extractKnownToolCall = (
  response: OpenAI.Responses.Response,
): (OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName }) | null =>
  response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall & { name: KnownToolName } =>
      item.type === 'function_call' && isKnownToolName(item.name),
  ) ?? null

const toSearchReplaceOperations = (value: unknown): SearchReplaceOperation[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): SearchReplaceOperation[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.search !== 'string' || typeof record.replace !== 'string') return []

    const replaceAll = record.replaceAll === true || record.replace_all === true || record.all === true
    const useRegex = record.useRegex === true || record.use_regex === true || record.regex === true
    const caseSensitive = typeof record.caseSensitive === 'boolean'
      ? record.caseSensitive
      : typeof record.case_sensitive === 'boolean'
        ? record.case_sensitive
        : undefined
    const regexFlags = typeof record.regexFlags === 'string'
      ? record.regexFlags
      : typeof record.regex_flags === 'string'
        ? record.regex_flags
        : undefined

    return [{
      search: record.search,
      replace: record.replace,
      replaceAll,
      useRegex,
      caseSensitive,
      regexFlags,
    }]
  })
}

const extractBodySnippet = (html: string): string => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const source = bodyMatch?.[1] ?? html
  const normalized = source.replace(/<script[\s\S]*?<\/script>/gi, (chunk) =>
    chunk.length > 400 ? '<script>/* omitted long script */</script>' : chunk,
  )
  return normalized.slice(0, 5000)
}

const artifactContextForRouter = (artifact: ArtifactDocument | null | undefined): string => {
  if (!artifact) {
    return 'Current artifact: none.'
  }
  const snippet = extractBodySnippet(artifact.html)
  return [
    'Current artifact context:',
    `- id: ${artifact.id}`,
    `- title: ${artifact.title}`,
    `- packs: ${artifact.packs.join(', ') || 'none'}`,
    `- html_length: ${artifact.html.length}`,
    'Body snippet (truncated):',
    '```html',
    snippet,
    '```',
  ].join('\n')
}

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

export const runAgentTurn = async (
  userMessage: string,
  options: RunAgentTurnOptions = {},
): Promise<AgentTurnResult> => {
  const currentArtifact = options.currentArtifact ?? null
  const prompt = userMessage.trim()
  if (!prompt) {
    return { kind: 'chat', text: 'Please type a prompt.' }
  }

  emitProgress(options, {
    phase: 'interpreting_request',
    message: 'Understanding request intent...',
  })

  if (!openai) {
    const artifact = await generateArtifact(
      { prompt, serverBaseUrl: options.serverBaseUrl },
      {
        onProgress: options.onProgress,
      } satisfies GenerateArtifactOptions,
    )
    return {
      kind: 'artifact',
      action: 'created',
      text: `Created "${artifact.title}".`,
      artifact,
    }
  }

  emitProgress(options, {
    phase: 'calling_model',
    message: 'Deciding whether this turn needs an artifact...',
  })

  const firstResponse = await openai.responses.create({
    model: ENV.model,
    reasoning: { effort: ENV.reasoningEffort },
    instructions: ROUTER_INSTRUCTIONS,
    input: [`User message:\n${prompt}`, artifactContextForRouter(currentArtifact)].join('\n\n'),
    tools: [artifactTool, editArtifactTool],
    parallel_tool_calls: false,
  })

  const toolCall = extractKnownToolCall(firstResponse)
  if (!toolCall) {
    const text = firstResponse.output_text?.trim()
    return {
      kind: 'chat',
      text: text && text.length > 0 ? text : localChatFallback(),
    }
  }

  if (toolCall.name === 'create_artifact') {
    const parsed = parseJson<CreateArtifactToolInput>(toolCall.arguments) ?? {}
    const requestedPrompt = typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0
      ? parsed.prompt.trim()
      : prompt
    const requestedPacks = Array.isArray(parsed.packs)
      ? parsed.packs.filter((value): value is string => typeof value === 'string')
      : undefined

    const artifact = await generateArtifact(
      { prompt: requestedPrompt, packs: requestedPacks, serverBaseUrl: options.serverBaseUrl },
      {
        onProgress: options.onProgress,
      } satisfies GenerateArtifactOptions,
    )

    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: true,
        action: 'created',
        artifactId: artifact.id,
        title: artifact.title,
        packs: artifact.packs,
      }),
    )

    return {
      kind: 'artifact',
      action: 'created',
      text: followup || `Created "${artifact.title}".`,
      artifact,
    }
  }

  if (!currentArtifact) {
    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: false,
        reason: 'No current artifact available to edit.',
      }),
    )
    return {
      kind: 'chat',
      text: followup || 'No current artifact to edit yet. Ask me to create one first.',
    }
  }

  const parsedEdit = parseJson<EditArtifactToolInput>(toolCall.arguments) ?? {}
  const replacements = toSearchReplaceOperations(parsedEdit.replacements)
  const instructions = typeof parsedEdit.instructions === 'string' && parsedEdit.instructions.trim().length > 0
    ? parsedEdit.instructions.trim()
    : prompt
  const title = typeof parsedEdit.title === 'string' ? parsedEdit.title : undefined

  if (replacements.length === 0) {
    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: false,
        reason: 'No valid search/replace operations were provided.',
      }),
    )
    return {
      kind: 'chat',
      text: followup || 'I need explicit search/replace operations to edit the current artifact.',
    }
  }

  emitProgress(options, {
    phase: 'assembling_document',
    message: `Applying ${replacements.length} search/replace operation(s)...`,
  })

  const edit = editArtifactWithSearchReplace({
    artifact: currentArtifact,
    replacements,
    instructions,
    title,
  })
  const totalMatches = edit.reports.reduce((sum, report) => sum + report.matches, 0)

  if (totalMatches === 0) {
    const followup = await completeToolTurn(
      firstResponse.id,
      toolCall.call_id,
      JSON.stringify({
        ok: false,
        reason: 'No search pattern matched current artifact HTML.',
        reports: edit.reports,
      }),
    )
    return {
      kind: 'chat',
      text: followup || 'None of the search patterns matched the current artifact. Give me more exact strings to replace.',
    }
  }

  const followup = await completeToolTurn(
    firstResponse.id,
    toolCall.call_id,
    JSON.stringify({
      ok: true,
      action: 'edited',
      artifactId: edit.artifact.id,
      title: edit.artifact.title,
      packs: edit.artifact.packs,
      totalMatches,
      reports: edit.reports,
    }),
  )

  return {
    kind: 'artifact',
    action: 'edited',
    text: followup || `Updated "${edit.artifact.title}" with ${totalMatches} replacement(s).`,
    artifact: edit.artifact,
  }
}
