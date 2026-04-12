import type {
  ResponseCreateParamsBase,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseIncludable,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
  Tool,
} from 'openai/resources/responses/responses'
import type {
  AiProviderNativeToolName,
  AiToolChoice,
  AiToolDefinition,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import { DomainErrorException } from '../../../shared/errors'

interface OpenAiRequestConfig {
  defaultServiceTier: 'auto' | 'default' | 'flex' | 'scale' | 'priority' | null
  maxRetries: number
  timeoutMs: number
}

const openAiResponseIncludableValues = [
  'file_search_call.results',
  'web_search_call.results',
  'web_search_call.action.sources',
  'message.input_image.image_url',
  'computer_call_output.output.image_url',
  'code_interpreter_call.outputs',
  'reasoning.encrypted_content',
  'message.output_text.logprobs',
] as const

const openAiRequiredWebSearchInclude = ['web_search_call.action.sources'] as const
const openAiRequiredReasoningInclude = ['reasoning.encrypted_content'] as const
const openAiFunctionToolNamePattern = /^[a-zA-Z0-9_-]+$/

const ensureOpenAiCompatibleRequest = (request: ResolvedAiInteractionRequest): void => {
  if (request.stopSequences && request.stopSequences.length > 0) {
    throw new DomainErrorException({
      message: 'OpenAI Responses requests do not expose stop sequences through this adapter',
      type: 'validation',
    })
  }

  for (const [index, tool] of (request.tools ?? []).entries()) {
    if (!openAiFunctionToolNamePattern.test(tool.name)) {
      throw new DomainErrorException({
        message:
          `OpenAI function tool name at index ${index} is invalid: ` +
          `"${tool.name}". Expected /^[a-zA-Z0-9_-]+$/.`,
        type: 'validation',
      })
    }
  }
}

const isOpenAiResponseIncludable = (value: string): value is ResponseIncludable =>
  openAiResponseIncludableValues.some((candidate) => candidate === value)

const toOpenAiInclude = (
  include: string[] | undefined,
  nativeTools: AiProviderNativeToolName[] | undefined,
  request: Pick<ResolvedAiInteractionRequest, 'reasoning'>,
): ResponseIncludable[] | undefined => {
  const mergedInclude = new Set(include ?? [])

  if (nativeTools?.includes('web_search')) {
    for (const value of openAiRequiredWebSearchInclude) {
      mergedInclude.add(value)
    }
  }

  if (request.reasoning && request.reasoning.effort !== 'none') {
    for (const value of openAiRequiredReasoningInclude) {
      mergedInclude.add(value)
    }
  }

  if (mergedInclude.size === 0) {
    return undefined
  }

  return [...mergedInclude].map((value) => {
    if (!isOpenAiResponseIncludable(value)) {
      throw new DomainErrorException({
        message: `OpenAI include "${value}" is not supported by this adapter`,
        type: 'validation',
      })
    }

    return value
  })
}

const isReasoningSummaryPart = (
  value: unknown,
): value is ResponseReasoningItem['summary'][number] =>
  typeof value === 'object' &&
  value !== null &&
  'text' in value &&
  typeof value.text === 'string' &&
  'type' in value &&
  value.type === 'summary_text'

const toOpenAiReasoningSummary = (summary: unknown): ResponseReasoningItem['summary'] => {
  if (!Array.isArray(summary) || !summary.every(isReasoningSummaryPart)) {
    throw new DomainErrorException({
      message: 'OpenAI reasoning replay summary must be an array of summary_text parts',
      type: 'validation',
    })
  }

  return summary
}

const toOpenAiMessageContent = (
  message: ResolvedAiInteractionRequest['messages'][number],
): ResponseInputContent[] => {
  const content: ResponseInputContent[] = []

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        content.push({ text: part.text, type: 'input_text' })
        break
      case 'image_url':
        content.push({
          detail: part.detail ?? 'auto',
          image_url: part.url,
          type: 'input_image',
        })
        break
      case 'image_file':
        content.push({
          detail: part.detail ?? 'auto',
          file_id: part.fileId,
          type: 'input_image',
        })
        break
      case 'file_url':
        content.push({
          file_url: part.url,
          filename: part.filename,
          type: 'input_file',
        })
        break
      case 'file_id':
        content.push({
          file_id: part.fileId,
          filename: part.filename,
          type: 'input_file',
        })
        break
      case 'function_call':
      case 'function_result':
      case 'reasoning':
        break
    }
  }

  return content
}

const toOpenAiAssistantMessage = (
  message: ResolvedAiInteractionRequest['messages'][number],
): ResponseOutputMessage | null => {
  if (message.role !== 'assistant') {
    return null
  }

  const content: ResponseOutputMessage['content'] = []

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        content.push({
          annotations: [],
          text: part.text,
          type: 'output_text',
        })
        break
      case 'function_call':
      case 'function_result':
      case 'reasoning':
        break
      case 'file_id':
      case 'file_url':
      case 'image_file':
      case 'image_url':
        throw new DomainErrorException({
          message: `OpenAI assistant replay does not support ${part.type} content yet`,
          type: 'validation',
        })
    }
  }

  if (content.length === 0) {
    return null
  }

  return {
    content,
    id: message.providerMessageId ?? `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    phase: message.phase ?? null,
    role: 'assistant',
    status: 'completed',
    type: 'message',
  }
}

const toOpenAiInput = (request: ResolvedAiInteractionRequest): ResponseInputItem[] => {
  const items: ResponseInputItem[] = []

  for (const message of request.messages) {
    if (message.role === 'assistant') {
      const assistantMessage = toOpenAiAssistantMessage(message)

      if (assistantMessage) {
        items.push(assistantMessage)
      }
    } else {
      const messageContent = toOpenAiMessageContent(message)

      if (messageContent.length > 0) {
        if (message.role === 'tool') {
          throw new DomainErrorException({
            message: 'Tool messages must only contain function results for the OpenAI adapter',
            type: 'validation',
          })
        }

        items.push({
          content: messageContent,
          role: message.role,
          type: 'message',
        })
      }
    }

    for (const part of message.content) {
      if (part.type === 'function_call') {
        if (message.role !== 'assistant') {
          throw new DomainErrorException({
            message: 'Function calls must be emitted by assistant messages',
            type: 'validation',
          })
        }

        items.push({
          arguments: part.argumentsJson,
          call_id: part.callId,
          name: part.name,
          status: 'completed',
          type: 'function_call',
        })
        continue
      }

      if (part.type === 'function_result') {
        items.push({
          call_id: part.callId,
          output: part.outputJson,
          status: 'completed',
          type: 'function_call_output',
        })
        continue
      }

      if (part.type === 'reasoning') {
        items.push({
          encrypted_content: part.encryptedContent ?? undefined,
          id: part.id,
          summary: toOpenAiReasoningSummary(part.summary),
          type: 'reasoning',
        })
      }
    }
  }

  return items
}

const toOpenAiFunctionTools = (tools: AiToolDefinition[] | undefined): Tool[] =>
  (tools ?? []).map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
    strict: tool.strict ?? true,
    type: 'function',
  }))

const toOpenAiNativeTools = (nativeTools: AiProviderNativeToolName[] | undefined): Tool[] => {
  if (!nativeTools?.includes('web_search')) {
    return []
  }

  return [
    {
      search_context_size: 'medium',
      type: 'web_search',
    },
  ]
}

const toOpenAiTools = (
  tools: AiToolDefinition[] | undefined,
  nativeTools: AiProviderNativeToolName[] | undefined,
): Tool[] | undefined => {
  const resolvedTools = [...toOpenAiFunctionTools(tools), ...toOpenAiNativeTools(nativeTools)]

  return resolvedTools.length > 0 ? resolvedTools : undefined
}

const toOpenAiToolChoice = (toolChoice: AiToolChoice | undefined) => {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  return {
    name: toolChoice.name,
    type: 'function' as const,
  }
}

const createBaseRequestBody = (
  request: ResolvedAiInteractionRequest,
  config: OpenAiRequestConfig,
): Omit<ResponseCreateParamsBase, 'stream'> => {
  ensureOpenAiCompatibleRequest(request)

  return {
    background: request.executionMode === 'background',
    conversation: request.vendorOptions?.openai?.conversationId,
    include: toOpenAiInclude(request.vendorOptions?.openai?.include, request.nativeTools, request),
    input: toOpenAiInput(request),
    max_output_tokens: request.maxOutputTokens,
    metadata: request.metadata,
    model: request.model,
    parallel_tool_calls: request.allowParallelToolCalls,
    previous_response_id: request.vendorOptions?.openai?.previousResponseId,
    prompt_cache_key: request.vendorOptions?.openai?.promptCacheKey,
    prompt_cache_retention: request.vendorOptions?.openai?.promptCacheRetention,
    reasoning: request.reasoning
      ? {
          effort: request.reasoning.effort,
          summary:
            request.reasoning.effort === 'none'
              ? request.reasoning.summary
              : (request.reasoning.summary ?? 'auto'),
        }
      : undefined,
    safety_identifier: request.vendorOptions?.openai?.safetyIdentifier,
    service_tier: request.serviceTier ?? config.defaultServiceTier,
    store: request.vendorOptions?.openai?.store,
    temperature: request.temperature,
    text:
      request.responseFormat?.type === 'json_schema'
        ? {
            format: {
              description: request.responseFormat.description,
              name: request.responseFormat.name,
              schema: request.responseFormat.schema,
              strict: request.responseFormat.strict,
              type: 'json_schema',
            },
          }
        : {
            format: {
              type: 'text',
            },
          },
    tool_choice: toOpenAiToolChoice(request.toolChoice),
    tools: toOpenAiTools(request.tools, request.nativeTools),
    top_p: request.topP,
  }
}

export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenAiRequestConfig,
  stream: true,
): ResponseCreateParamsStreaming
export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenAiRequestConfig,
  stream: false,
): ResponseCreateParamsNonStreaming
export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenAiRequestConfig,
  stream: boolean,
): ResponseCreateParamsNonStreaming | ResponseCreateParamsStreaming {
  const baseBody = createBaseRequestBody(request, config)

  return stream
    ? {
        ...baseBody,
        stream: true,
      }
    : {
        ...baseBody,
        stream: false,
      }
}

export const createRequestOptions = (
  request: ResolvedAiInteractionRequest,
  config: Pick<OpenAiRequestConfig, 'maxRetries' | 'timeoutMs'>,
) => ({
  idempotencyKey: request.idempotencyKey,
  maxRetries: request.maxRetries ?? config.maxRetries,
  signal: request.abortSignal,
  timeout: request.timeoutMs ?? config.timeoutMs,
})
