import {
  type Content,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type HttpOptions,
  type Part,
  ServiceTier,
  type ThinkingConfig,
  ThinkingLevel,
  type Tool,
  type ToolConfig,
} from '@google/genai'

import { isRecord, parseRequiredJson } from '../../../domain/ai/json-utils'
import type {
  AiProviderNativeToolName,
  AiReasoningEffort,
  AiServiceTier,
  AiToolChoice,
  AiToolDefinition,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import { DomainErrorException } from '../../../shared/errors'

interface GoogleRequestConfig {
  defaultHttpTimeoutMs: number
  maxRetries: number
}

export const ensureGoogleCompatibleRequest = (request: ResolvedAiInteractionRequest): void => {
  if (request.executionMode === 'background') {
    throw new DomainErrorException({
      message: 'Google GenAI requests do not support background execution in this adapter',
      type: 'validation',
    })
  }
}

const mapServiceTier = (serviceTier: AiServiceTier | undefined): ServiceTier | undefined => {
  switch (serviceTier) {
    case 'auto':
      return undefined
    case 'default':
    case 'scale':
      return ServiceTier.SERVICE_TIER_STANDARD
    case 'flex':
      return ServiceTier.SERVICE_TIER_FLEX
    case 'priority':
      return ServiceTier.SERVICE_TIER_PRIORITY
  }
}

const toGoogleFunctionResponse = (
  part: Extract<
    ResolvedAiInteractionRequest['messages'][number]['content'][number],
    { type: 'function_result' }
  >,
) => {
  const parsed = parseRequiredJson(part.outputJson, `Function result "${part.name}"`)

  if (part.isError) {
    return {
      error: parsed,
    }
  }

  if (isRecord(parsed)) {
    return parsed
  }

  return {
    output: parsed,
  }
}

const toGoogleReasoningText = (
  part: Extract<
    ResolvedAiInteractionRequest['messages'][number]['content'][number],
    { type: 'reasoning' }
  >,
): string | undefined => {
  if (typeof part.text === 'string' && part.text.trim().length > 0) {
    return part.text
  }

  if (!Array.isArray(part.summary)) {
    return undefined
  }

  const text = part.summary
    .flatMap((summaryPart) => {
      if (
        typeof summaryPart === 'object' &&
        summaryPart !== null &&
        'text' in summaryPart &&
        typeof summaryPart.text === 'string'
      ) {
        return [summaryPart.text]
      }

      return []
    })
    .join('')
    .trim()

  return text.length > 0 ? text : undefined
}

const toGoogleFunctionCallArgs = (
  argumentsJson: string,
  functionName: string,
): Record<string, unknown> | undefined => {
  const parsed = parseRequiredJson(argumentsJson, `Function call "${functionName}" arguments`)

  if (parsed === null) {
    return undefined
  }

  if (!isRecord(parsed)) {
    throw new DomainErrorException({
      message: `Function call "${functionName}" arguments must be a JSON object`,
      type: 'validation',
    })
  }

  return parsed
}

const toGooglePart = (
  message: ResolvedAiInteractionRequest['messages'][number],
  part: ResolvedAiInteractionRequest['messages'][number]['content'][number],
): Part => {
  switch (part.type) {
    case 'text':
      return {
        ...(part.thought === true ? { thought: true } : {}),
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        text: part.text,
      }
    case 'function_call':
      if (message.role !== 'assistant') {
        throw new DomainErrorException({
          message: 'Function calls must be emitted by assistant messages',
          type: 'validation',
        })
      }

      return {
        functionCall: {
          args: toGoogleFunctionCallArgs(part.argumentsJson, part.name),
          id: part.callId,
          name: part.name,
        },
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      }
    case 'function_result':
      return {
        functionResponse: {
          id: part.callId,
          name: part.name,
          response: toGoogleFunctionResponse(part),
        },
      }
    case 'file_url':
      if (!part.url.startsWith('gs://')) {
        throw new DomainErrorException({
          message: 'Google GenAI file inputs currently require gs:// URIs in this adapter',
          type: 'validation',
        })
      }

      return {
        fileData: {
          fileUri: part.url,
          mimeType: part.mimeType ?? 'application/octet-stream',
        },
      }
    case 'image_url':
      if (!part.url.startsWith('gs://')) {
        throw new DomainErrorException({
          message: 'Google GenAI image inputs currently require gs:// URIs in this adapter',
          type: 'validation',
        })
      }

      return {
        fileData: {
          fileUri: part.url,
          mimeType: part.mimeType ?? 'image/*',
        },
      }
    case 'file_id':
    case 'image_file':
      throw new DomainErrorException({
        message: `Google GenAI adapter does not support ${part.type} inputs yet`,
        type: 'validation',
      })
    case 'reasoning': {
      const reasoningText = toGoogleReasoningText(part)

      return {
        ...(part.id ? { thoughtSignature: part.id } : {}),
        ...(part.thought === false ? {} : { thought: true }),
        ...(reasoningText ? { text: reasoningText } : {}),
      }
    }
  }
}

const buildSystemInstruction = (
  messages: ResolvedAiInteractionRequest['messages'],
): Content | undefined => {
  const textParts: Array<{ text: string }> = []

  for (const message of messages) {
    if (message.role !== 'system' && message.role !== 'developer') {
      continue
    }

    for (const part of message.content) {
      if (part.type !== 'text') {
        throw new DomainErrorException({
          message: 'Google GenAI system and developer messages currently support text only',
          type: 'validation',
        })
      }

      textParts.push({ text: part.text })
    }
  }

  if (textParts.length === 0) {
    return undefined
  }

  return {
    parts: textParts,
  }
}

const buildContents = (messages: ResolvedAiInteractionRequest['messages']): Content[] => {
  const contents: Content[] = []

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      continue
    }

    const parts = message.content.map((part) => toGooglePart(message, part))

    if (parts.length === 0) {
      continue
    }

    contents.push({
      parts,
      role: message.role === 'assistant' ? 'model' : 'user',
    })
  }

  return contents
}

const sanitizeSchemaNode = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(sanitizeSchemaNode)
  }

  if (node === null || typeof node !== 'object') {
    return node
  }

  const src = node as Record<string, unknown>

  // Resolve $ref — Gemini does not support JSON Schema references
  if (typeof src.$ref === 'string' && typeof src.$defs === 'undefined') {
    return { type: 'object' }
  }

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(src)) {
    // Strip keywords Gemini does not support
    if (
      key === '$ref' ||
      key === '$defs' ||
      key === '$schema' ||
      key === '$id' ||
      key === '$comment' ||
      key === 'oneOf' ||
      key === 'anyOf' ||
      key === 'allOf' ||
      key === 'not' ||
      key === 'if' ||
      key === 'then' ||
      key === 'else' ||
      key === 'dependentSchemas' ||
      key === 'dependentRequired' ||
      key === 'patternProperties' ||
      key === 'unevaluatedProperties' ||
      key === 'unevaluatedItems' ||
      key === 'contentMediaType' ||
      key === 'contentEncoding' ||
      key === 'const' ||
      key === 'examples' ||
      key === 'default'
    ) {
      continue
    }

    out[key] = sanitizeSchemaNode(value)
  }

  return out
}

const sanitizeToolSchema = (
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!schema) {
    return undefined
  }

  const sanitized = sanitizeSchemaNode(schema) as Record<string, unknown>

  // Gemini requires top-level type: "object"
  if (!sanitized.type) {
    sanitized.type = 'object'
  }

  return sanitized
}

const buildFunctionTools = (tools: AiToolDefinition[] | undefined): Tool[] => {
  if (!tools || tools.length === 0) {
    return []
  }

  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
    description: tool.description,
    name: tool.name,
    parametersJsonSchema: sanitizeToolSchema(tool.parameters),
  }))

  return [{ functionDeclarations }]
}

const buildNativeTools = (nativeTools: AiProviderNativeToolName[] | undefined): Tool[] => {
  if (!nativeTools?.includes('web_search')) {
    return []
  }

  return [
    {
      googleSearch: {},
    },
  ]
}

const buildTools = (
  tools: AiToolDefinition[] | undefined,
  nativeTools: AiProviderNativeToolName[] | undefined,
): Tool[] | undefined => {
  const resolvedTools = [...buildFunctionTools(tools), ...buildNativeTools(nativeTools)]

  return resolvedTools.length > 0 ? resolvedTools : undefined
}

const buildToolConfig = (
  tools: AiToolDefinition[] | undefined,
  toolChoice: AiToolChoice | undefined,
  nativeTools: AiProviderNativeToolName[] | undefined,
): ToolConfig | undefined => {
  const hasNativeTools = nativeTools && nativeTools.length > 0
  const hasFunctionTools = tools && tools.length > 0

  // Gemini 3 requires this flag when combining built-in tools (googleSearch)
  // with function calling in the same request.
  const includeServerSideToolInvocations = hasNativeTools && hasFunctionTools ? true : undefined

  if (!hasFunctionTools || !toolChoice) {
    return includeServerSideToolInvocations ? { includeServerSideToolInvocations } : undefined
  }

  if (toolChoice === 'auto') {
    return {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
      includeServerSideToolInvocations,
    }
  }

  if (toolChoice === 'none') {
    return {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.NONE,
      },
      includeServerSideToolInvocations,
    }
  }

  if (toolChoice === 'required') {
    return {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
      },
      includeServerSideToolInvocations,
    }
  }

  return {
    functionCallingConfig: {
      allowedFunctionNames: [toolChoice.name],
      mode: FunctionCallingConfigMode.ANY,
    },
    includeServerSideToolInvocations,
  }
}

const buildHttpOptions = (
  request: ResolvedAiInteractionRequest,
  config: GoogleRequestConfig,
): HttpOptions => ({
  timeout: request.timeoutMs ?? config.defaultHttpTimeoutMs,
  retryOptions: {
    attempts: (request.maxRetries ?? config.maxRetries) + 1,
  },
})

const toThinkingLevel = (effort: AiReasoningEffort): ThinkingLevel | undefined => {
  switch (effort) {
    case 'minimal':
      return ThinkingLevel.MINIMAL
    case 'low':
      return ThinkingLevel.LOW
    case 'medium':
      return ThinkingLevel.MEDIUM
    case 'high':
    case 'xhigh':
      return ThinkingLevel.HIGH
    default:
      return undefined
  }
}

const toThinkingConfig = (
  reasoning: ResolvedAiInteractionRequest['reasoning'],
): ThinkingConfig | undefined => {
  if (!reasoning) {
    return undefined
  }

  if (reasoning.effort === 'none') {
    return { thinkingBudget: 0 }
  }

  const level = toThinkingLevel(reasoning.effort)

  return {
    includeThoughts: true,
    ...(level ? { thinkingLevel: level } : {}),
  }
}

export const buildConfig = (
  request: ResolvedAiInteractionRequest,
  config: GoogleRequestConfig,
): GenerateContentConfig => {
  const thinkingConfig = toThinkingConfig(request.reasoning)

  return {
    abortSignal: request.abortSignal,
    cachedContent: request.vendorOptions?.google?.cachedContent,
    httpOptions: buildHttpOptions(request, config),
    maxOutputTokens: request.maxOutputTokens,
    responseJsonSchema:
      request.responseFormat?.type === 'json_schema' ? request.responseFormat.schema : undefined,
    responseMimeType:
      request.responseFormat?.type === 'json_schema' ? 'application/json' : undefined,
    serviceTier: mapServiceTier(request.serviceTier),
    stopSequences: request.stopSequences,
    systemInstruction: buildSystemInstruction(request.messages),
    temperature: request.temperature,
    thinkingConfig,
    toolConfig: buildToolConfig(request.tools, request.toolChoice, request.nativeTools),
    tools: buildTools(request.tools, request.nativeTools),
    topP: request.topP,
  }
}

export const buildContentsForRequest = buildContents
