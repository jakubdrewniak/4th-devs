import type { Candidate, FunctionCall, GenerateContentResponse, Part } from '@google/genai'
import { BlockedReason, FinishReason } from '@google/genai'

import type {
  AiInteractionResponse,
  AiMessage,
  AiOutputItem,
  AiReasoningContent,
  AiToolCall,
  AiUsage,
  AiWebReference,
  AiWebSearchActivity,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'

export const normalizeToolCall = (
  toolCall: FunctionCall,
  index: number,
  thoughtSignature?: string,
): AiToolCall => {
  const callId =
    toolCall.id ?? `${toolCall.name ?? 'tool'}:${index}:${JSON.stringify(toolCall.args ?? null)}`

  return {
    arguments: toolCall.args ?? null,
    argumentsJson: JSON.stringify(toolCall.args ?? {}),
    callId,
    name: toolCall.name ?? 'unknown_function',
    ...(thoughtSignature ? { thoughtSignature } : {}),
  }
}

export const mapUsage = (response: GenerateContentResponse): AiUsage | null => {
  if (!response.usageMetadata) {
    return null
  }

  return {
    cachedTokens: response.usageMetadata.cachedContentTokenCount ?? null,
    inputTokens: response.usageMetadata.promptTokenCount ?? null,
    outputTokens: response.usageMetadata.candidatesTokenCount ?? null,
    reasoningTokens: response.usageMetadata.thoughtsTokenCount ?? null,
    totalTokens: response.usageMetadata.totalTokenCount ?? null,
  }
}

export const getRequestId = (response: GenerateContentResponse): string | null =>
  response.sdkHttpResponse?.headers?.['x-request-id'] ?? null

const getPrimaryCandidate = (response: GenerateContentResponse): Candidate | null =>
  response.candidates?.[0] ?? null

const getCandidateParts = (response: GenerateContentResponse): Part[] =>
  getPrimaryCandidate(response)?.content?.parts ?? []

const getThoughtItemId = (thoughtSignature: string | undefined, index: number): string =>
  thoughtSignature?.trim() || `google_thought:${index}`

const toDomainFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.trim()
    return hostname.length > 0 ? hostname : null
  } catch {
    return null
  }
}

const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const dedupeWebReferences = (references: AiWebReference[]): AiWebReference[] => {
  const byUrl = new Map<string, AiWebReference>()

  for (const reference of references) {
    const existing = byUrl.get(reference.url)

    if (!existing) {
      byUrl.set(reference.url, reference)
      continue
    }

    byUrl.set(reference.url, {
      domain: existing.domain ?? reference.domain,
      title: existing.title ?? reference.title,
      url: reference.url,
    })
  }

  return [...byUrl.values()]
}

const normalizeGroundingReferences = (response: GenerateContentResponse): AiWebReference[] => {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const references: AiWebReference[] = []

  for (const chunk of chunks) {
    if (chunk.web?.uri) {
      references.push({
        domain: chunk.web.domain ?? toDomainFromUrl(chunk.web.uri),
        title: chunk.web.title ?? null,
        url: chunk.web.uri,
      })
      continue
    }

    if (chunk.image?.sourceUri) {
      references.push({
        domain: chunk.image.domain ?? toDomainFromUrl(chunk.image.sourceUri),
        title: chunk.image.title ?? null,
        url: chunk.image.sourceUri,
      })
      continue
    }

    if (chunk.retrievedContext?.uri) {
      references.push({
        domain: toDomainFromUrl(chunk.retrievedContext.uri),
        title: chunk.retrievedContext.title ?? null,
        url: chunk.retrievedContext.uri,
      })
      continue
    }

    if (chunk.maps?.uri) {
      references.push({
        domain: toDomainFromUrl(chunk.maps.uri),
        title: chunk.maps.title ?? null,
        url: chunk.maps.uri,
      })
    }
  }

  return dedupeWebReferences(references)
}

const normalizeWebSearches = (response: GenerateContentResponse): AiWebSearchActivity[] => {
  const queries = dedupeStrings(response.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [])
  const references = normalizeGroundingReferences(response)

  if (queries.length === 0 && references.length === 0) {
    return []
  }

  return [
    {
      id: response.responseId ? `web_search:${response.responseId}` : 'web_search:google',
      patterns: [],
      provider: 'google',
      queries,
      references,
      responseId: response.responseId ?? null,
      status: 'completed',
      targetUrls: [],
    },
  ]
}

interface GoogleTerminalIssue {
  message: string
  status: Extract<AiInteractionResponse['status'], 'failed' | 'incomplete'>
}

const toPromptBlockedIssue = (
  feedback: GenerateContentResponse['promptFeedback'],
): GoogleTerminalIssue | null => {
  if (!feedback?.blockReason) {
    return null
  }

  const explicitMessage = feedback.blockReasonMessage?.trim()

  if (explicitMessage) {
    return {
      message: `Google GenAI blocked the prompt: ${explicitMessage}`,
      status: 'failed',
    }
  }

  switch (feedback.blockReason) {
    case BlockedReason.SAFETY:
      return {
        message: 'Google GenAI blocked the prompt for safety reasons.',
        status: 'failed',
      }
    case BlockedReason.BLOCKLIST:
      return {
        message: 'Google GenAI blocked the prompt because it contains blocked terms.',
        status: 'failed',
      }
    case BlockedReason.PROHIBITED_CONTENT:
      return {
        message: 'Google GenAI blocked the prompt because it contains prohibited content.',
        status: 'failed',
      }
    case BlockedReason.IMAGE_SAFETY:
      return {
        message: 'Google GenAI blocked the prompt because it is unsafe for image generation.',
        status: 'failed',
      }
    case BlockedReason.OTHER:
      return {
        message: 'Google GenAI blocked the prompt for policy reasons.',
        status: 'failed',
      }
    default:
      return {
        message: `Google GenAI blocked the prompt (${feedback.blockReason}).`,
        status: 'failed',
      }
  }
}

const toCandidateFinishIssue = (candidate: Candidate | null): GoogleTerminalIssue | null => {
  if (!candidate?.finishReason || candidate.finishReason === FinishReason.STOP) {
    return null
  }

  const explicitMessage = candidate.finishMessage?.trim()

  switch (candidate.finishReason) {
    case FinishReason.MAX_TOKENS:
      return {
        message:
          explicitMessage || 'Google GenAI stopped after reaching the maximum output tokens.',
        status: 'incomplete',
      }
    case FinishReason.SAFETY:
      return {
        message:
          explicitMessage ||
          'Google GenAI stopped because the response triggered safety filtering.',
        status: 'failed',
      }
    case FinishReason.RECITATION:
      return {
        message: explicitMessage || 'Google GenAI stopped because the response risked recitation.',
        status: 'failed',
      }
    case FinishReason.LANGUAGE:
      return {
        message:
          explicitMessage ||
          'Google GenAI stopped because the response used an unsupported language.',
        status: 'failed',
      }
    case FinishReason.BLOCKLIST:
      return {
        message:
          explicitMessage || 'Google GenAI stopped because the response contained blocked terms.',
        status: 'failed',
      }
    case FinishReason.PROHIBITED_CONTENT:
      return {
        message:
          explicitMessage ||
          'Google GenAI stopped because the response contained prohibited content.',
        status: 'failed',
      }
    case FinishReason.SPII:
      return {
        message:
          explicitMessage ||
          'Google GenAI stopped because the response may contain sensitive personal information.',
        status: 'failed',
      }
    case FinishReason.MALFORMED_FUNCTION_CALL:
      return {
        message: explicitMessage || 'Google GenAI returned a malformed function call.',
        status: 'failed',
      }
    case FinishReason.UNEXPECTED_TOOL_CALL:
      return {
        message: explicitMessage || 'Google GenAI returned an unexpected server-side tool call.',
        status: 'failed',
      }
    case FinishReason.IMAGE_SAFETY:
    case FinishReason.IMAGE_PROHIBITED_CONTENT:
    case FinishReason.IMAGE_RECITATION:
    case FinishReason.NO_IMAGE:
      return {
        message:
          explicitMessage ||
          `Google GenAI image generation stopped with finish reason ${candidate.finishReason}.`,
        status: 'failed',
      }
    default:
      return {
        message:
          explicitMessage || `Google GenAI stopped with finish reason ${candidate.finishReason}.`,
        status: 'failed',
      }
  }
}

const hasDurableOutput = (
  output: AiOutputItem[],
  outputText: string,
  toolCalls: AiToolCall[],
): boolean =>
  outputText.trim().length > 0 ||
  toolCalls.length > 0 ||
  output.some(
    (item) =>
      item.type === 'message' &&
      item.content.some((part) => part.type === 'text' && part.text.trim().length > 0),
  )

const getTerminalIssue = (
  response: GenerateContentResponse,
  output: AiOutputItem[],
  outputText: string,
  toolCalls: AiToolCall[],
): GoogleTerminalIssue | null => {
  if (hasDurableOutput(output, outputText, toolCalls)) {
    return null
  }

  return (
    toPromptBlockedIssue(response.promptFeedback) ??
    toCandidateFinishIssue(getPrimaryCandidate(response))
  )
}

const toThoughtSummary = (part: Part): AiReasoningContent['summary'] => {
  if (typeof part.text === 'string' && part.text.trim().length > 0) {
    return [{ text: part.text, type: 'summary_text' }]
  }

  return []
}

const flushAssistantMessage = (
  output: AiOutputItem[],
  textParts: Extract<AiMessage['content'][number], { type: 'text' }>[],
): void => {
  if (textParts.length === 0) {
    return
  }

  const flushedTextParts = textParts.splice(0, textParts.length)

  output.push({
    content: flushedTextParts,
    role: 'assistant',
    type: 'message',
  })
}

export const normalizeResponse = (
  request: ResolvedAiInteractionRequest,
  response: GenerateContentResponse,
): AiInteractionResponse => {
  const outputText = response.text ?? ''
  const output: AiOutputItem[] = []
  const toolCalls: AiToolCall[] = []
  const webSearches = normalizeWebSearches(response)
  const pendingTextParts: Extract<AiMessage['content'][number], { type: 'text' }>[] = []

  for (const [index, part] of getCandidateParts(response).entries()) {
    if (part.functionCall) {
      flushAssistantMessage(output, pendingTextParts)
      const toolCall = normalizeToolCall(part.functionCall, index, part.thoughtSignature)
      toolCalls.push(toolCall)
      output.push({
        ...toolCall,
        type: 'function_call',
      })
      continue
    }

    if (typeof part.text !== 'string') {
      continue
    }

    if (part.thought === true) {
      flushAssistantMessage(output, pendingTextParts)

      output.push({
        id: getThoughtItemId(part.thoughtSignature, index),
        summary: toThoughtSummary(part),
        text: part.text,
        thought: true,
        type: 'reasoning',
      })
      continue
    }

    pendingTextParts.push({
      ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      text: part.text,
      type: 'text',
    })
  }

  flushAssistantMessage(output, pendingTextParts)

  if (output.length === 0 && outputText.length > 0) {
    output.push({
      content: [{ text: outputText, type: 'text' }],
      role: 'assistant',
      type: 'message',
    })
  }

  const messages = output
    .filter((item): item is Extract<AiOutputItem, { type: 'message' }> => item.type === 'message')
    .map((item) => ({
      content: item.content,
      role: 'assistant' as const,
    }))
  const terminalIssue = getTerminalIssue(response, output, outputText, toolCalls)

  if (process.env.NODE_ENV !== 'production') {
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'Google GenAI normalizeResponse',
        messagesCount: messages.length,
        outputItemTypes: output.map((item) => item.type),
        outputText: outputText.slice(0, 200),
        partTypes: getCandidateParts(response).map((p) =>
          p.functionCall
            ? 'functionCall'
            : p.thought
              ? 'thought'
              : typeof p.text === 'string'
                ? 'text'
                : 'other',
        ),
        subsystem: 'google_provider',
        timestamp: new Date().toISOString(),
        toolCallCount: toolCalls.length,
      }),
    )
  }

  return {
    messages,
    model: response.modelVersion ?? request.model,
    output,
    outputText,
    provider: 'google',
    providerRequestId: getRequestId(response),
    raw: terminalIssue
      ? {
          error: {
            finishMessage: getPrimaryCandidate(response)?.finishMessage ?? null,
            finishReason: getPrimaryCandidate(response)?.finishReason ?? null,
            message: terminalIssue.message,
            promptBlockReason: response.promptFeedback?.blockReason ?? null,
          },
          response,
        }
      : response,
    responseId: response.responseId ?? null,
    status: terminalIssue?.status ?? 'completed',
    toolCalls,
    usage: mapUsage(response),
    webSearches,
  }
}
