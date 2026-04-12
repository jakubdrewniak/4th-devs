import { GoogleGenAI } from '@google/genai'
import type { AiProvider } from '../../../domain/ai/provider'
import type {
  AiCancelResult,
  AiInteractionResponse,
  AiStreamEvent,
  AiToolCall,
  AiWebSearchActivity,
} from '../../../domain/ai/types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toGoogleDomainError } from './google-domain-error'
import {
  buildConfig,
  buildContentsForRequest,
  ensureGoogleCompatibleRequest,
} from './google-request'
import { normalizeResponse } from './google-response'

export interface GoogleProviderConfig {
  apiKey: string | null
  apiVersion: string | null
  baseUrl: string | null
  defaultHttpTimeoutMs: number
  location: string | null
  maxRetries: number
  project: string | null
  vertexai: boolean
}

const resolveConfigured = (config: GoogleProviderConfig): boolean =>
  Boolean(config.apiKey) || (config.vertexai && Boolean(config.project) && Boolean(config.location))

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'Google GenAI provider is not configured',
    provider: 'google',
    type: 'provider',
  })

const toStreamDelta = (
  chunkText: string,
  accumulatedText: string,
): {
  delta: string
  nextAccumulatedText: string
} => {
  if (chunkText.length === 0) {
    return {
      delta: '',
      nextAccumulatedText: accumulatedText,
    }
  }

  if (chunkText.startsWith(accumulatedText)) {
    return {
      delta: chunkText.slice(accumulatedText.length),
      nextAccumulatedText: chunkText,
    }
  }

  return {
    delta: chunkText,
    nextAccumulatedText: accumulatedText + chunkText,
  }
}

const getThoughtItemId = (thoughtSignature: string | undefined, index: number): string =>
  thoughtSignature?.trim() || `google_thought:${index}`

const backfillGoogleStreamArtifacts = (
  response: AiInteractionResponse,
  accumulatedToolCalls: Map<string, AiToolCall>,
  accumulatedWebSearches: Map<string, AiWebSearchActivity>,
): AiInteractionResponse => {
  let nextOutput = response.output
  let nextToolCalls = response.toolCalls
  let nextWebSearches = response.webSearches

  if (accumulatedToolCalls.size > 0) {
    const mergedToolCalls = new Map<string, AiToolCall>()

    for (const toolCall of accumulatedToolCalls.values()) {
      mergedToolCalls.set(toolCall.callId, toolCall)
    }

    for (const toolCall of response.toolCalls) {
      mergedToolCalls.set(toolCall.callId, toolCall)
    }

    if (mergedToolCalls.size !== response.toolCalls.length) {
      nextToolCalls = [...mergedToolCalls.values()]

      const existingOutputCallIds = new Set(
        response.output
          .filter(
            (
              item,
            ): item is Extract<
              AiInteractionResponse['output'][number],
              { type: 'function_call' }
            > => item.type === 'function_call',
          )
          .map((item) => item.callId),
      )
      const missingOutputItems = nextToolCalls
        .filter((toolCall) => !existingOutputCallIds.has(toolCall.callId))
        .map((toolCall) => ({
          ...toolCall,
          type: 'function_call' as const,
        }))

      if (missingOutputItems.length > 0) {
        const firstMessageIndex = response.output.findIndex((item) => item.type === 'message')

        nextOutput =
          firstMessageIndex === -1
            ? [...response.output, ...missingOutputItems]
            : [
                ...response.output.slice(0, firstMessageIndex),
                ...missingOutputItems,
                ...response.output.slice(firstMessageIndex),
              ]
      }
    }
  }

  if (accumulatedWebSearches.size > 0 && response.webSearches.length === 0) {
    nextWebSearches = [...accumulatedWebSearches.values()]
  }

  if (
    nextOutput === response.output &&
    nextToolCalls === response.toolCalls &&
    nextWebSearches === response.webSearches
  ) {
    return response
  }

  return {
    ...response,
    output: nextOutput,
    toolCalls: nextToolCalls,
    webSearches: nextWebSearches,
  }
}

const installDiagnosticFetch = (): void => {
  const originalFetch = globalThis.fetch

  if ((originalFetch as { __googleDiagnostic?: boolean }).__googleDiagnostic) {
    return
  }

  const diagnosticFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await originalFetch(input, init)

    if (
      !response.ok &&
      typeof input === 'string' &&
      input.includes('generativelanguage.googleapis.com')
    ) {
      const cloned = response.clone()

      try {
        const body = await cloned.text()
        console.error(
          JSON.stringify({
            body: body.slice(0, 2000),
            level: 'error',
            message: 'Google GenAI HTTP error',
            status: response.status,
            statusText: response.statusText,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
          }),
        )
      } catch {}
    }

    return response
  }

  ;(diagnosticFetch as { __googleDiagnostic?: boolean }).__googleDiagnostic = true
  globalThis.fetch = diagnosticFetch as typeof globalThis.fetch
}

export const createGoogleProvider = (config: GoogleProviderConfig): AiProvider => {
  const configured = resolveConfigured(config)

  if (configured) {
    installDiagnosticFetch()
  }

  const client = configured
    ? new GoogleGenAI({
        apiKey: config.apiKey ?? undefined,
        apiVersion: config.apiVersion ?? undefined,
        httpOptions: {
          baseUrl: config.baseUrl ?? undefined,
          retryOptions: {
            attempts: config.maxRetries + 1,
          },
          timeout: config.defaultHttpTimeoutMs,
        },
        location: config.location ?? undefined,
        project: config.project ?? undefined,
        vertexai: config.vertexai,
      })
    : null

  return {
    cancel: async (request): Promise<Result<AiCancelResult, DomainError>> =>
      ok({
        provider: 'google',
        responseId: request.responseId,
        status: 'client_abort_only',
      }),
    configured,
    generate: async (request): Promise<Result<AiInteractionResponse, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        ensureGoogleCompatibleRequest(request)

        const response = await client.models.generateContent({
          config: buildConfig(request, config),
          contents: buildContentsForRequest(request.messages),
          model: request.model,
        })

        return ok(normalizeResponse(request, response))
      } catch (error) {
        const domainError = toGoogleDomainError(error)

        console.error(
          JSON.stringify({
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            domainType: domainError.type,
            level: 'error',
            message: 'Google GenAI generate failed',
            model: request.model,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
            toolCount: request.tools?.length ?? 0,
          }),
        )

        return err(domainError)
      }
    },
    name: 'google',
    stream: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        ensureGoogleCompatibleRequest(request)

        const responseStream = await client.models.generateContentStream({
          config: buildConfig(request, config),
          contents: buildContentsForRequest(request.messages),
          model: request.model,
        })

        return ok(
          (async function* (): AsyncGenerator<AiStreamEvent> {
            let accumulatedText = ''
            let finalChunk: Awaited<ReturnType<typeof client.models.generateContent>> | null = null
            const accumulatedReasoningText = new Map<string, string>()
            const accumulatedToolCalls = new Map<string, AiToolCall>()
            const accumulatedWebSearches = new Map<string, AiWebSearchActivity>()
            let firstPromptFeedback:
              | Awaited<ReturnType<typeof client.models.generateContent>>['promptFeedback']
              | undefined
            let firstResponseId: string | null = null
            let lastModelVersion: string | null = null
            let started = false

            for await (const chunk of responseStream) {
              finalChunk = chunk
              firstPromptFeedback ??= chunk.promptFeedback
              firstResponseId ??= chunk.responseId ?? null
              lastModelVersion = chunk.modelVersion ?? lastModelVersion

              const normalizedChunk = normalizeResponse(request, chunk)

              for (const toolCall of normalizedChunk.toolCalls) {
                accumulatedToolCalls.set(toolCall.callId, toolCall)
              }

              for (const activity of normalizedChunk.webSearches) {
                accumulatedWebSearches.set(activity.id, activity)
              }

              if (!started) {
                started = true
                yield {
                  model: chunk.modelVersion ?? request.model,
                  provider: 'google',
                  responseId: chunk.responseId ?? null,
                  type: 'response.started',
                }
              }

              const chunkText = chunk.text ?? ''
              const streamedText = toStreamDelta(chunkText, accumulatedText)

              accumulatedText = streamedText.nextAccumulatedText

              const thoughtParts = chunk.candidates?.[0]?.content?.parts ?? []

              for (const [index, part] of thoughtParts.entries()) {
                if (
                  part.thought !== true ||
                  typeof part.text !== 'string' ||
                  part.text.length === 0
                ) {
                  continue
                }

                const itemId = getThoughtItemId(part.thoughtSignature, index)
                const streamedReasoning = toStreamDelta(
                  part.text,
                  accumulatedReasoningText.get(itemId) ?? '',
                )

                accumulatedReasoningText.set(itemId, streamedReasoning.nextAccumulatedText)

                if (streamedReasoning.delta.length === 0) {
                  continue
                }

                yield {
                  delta: streamedReasoning.delta,
                  itemId,
                  text: streamedReasoning.nextAccumulatedText,
                  type: 'reasoning.summary.delta',
                }
              }

              if (streamedText.delta.length > 0) {
                yield {
                  delta: streamedText.delta,
                  type: 'text.delta',
                }
              }
            }

            if (!started || !finalChunk) {
              yield {
                model: request.model,
                provider: 'google',
                responseId: null,
                type: 'response.started',
              }
              yield {
                response: {
                  messages: [],
                  model: request.model,
                  output: [],
                  outputText: '',
                  provider: 'google',
                  providerRequestId: null,
                  raw: null,
                  responseId: null,
                  status: 'completed',
                  toolCalls: [],
                  usage: null,
                  webSearches: [],
                },
                type: 'response.completed',
              }
              return
            }

            finalChunk.promptFeedback ??= firstPromptFeedback

            if (!finalChunk.responseId && firstResponseId) {
              finalChunk.responseId = firstResponseId
            }

            if (!finalChunk.modelVersion && lastModelVersion) {
              finalChunk.modelVersion = lastModelVersion
            }

            const normalizedResponse = backfillGoogleStreamArtifacts(
              normalizeResponse(request, finalChunk),
              accumulatedToolCalls,
              accumulatedWebSearches,
            )

            for (const outputItem of normalizedResponse.output) {
              if (outputItem.type !== 'reasoning' || typeof outputItem.text !== 'string') {
                continue
              }

              yield {
                itemId: outputItem.id,
                text: outputItem.text,
                type: 'reasoning.summary.done',
              }
            }

            for (const activity of normalizedResponse.webSearches) {
              yield {
                activity,
                type: 'web_search',
              }
            }

            for (const toolCall of normalizedResponse.toolCalls) {
              yield {
                call: toolCall,
                type: 'tool.call',
              }
            }

            yield {
              response: normalizedResponse,
              type: 'response.completed',
            }
          })(),
        )
      } catch (error) {
        const domainError = toGoogleDomainError(error)

        console.error(
          JSON.stringify({
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            domainType: domainError.type,
            level: 'error',
            message: 'Google GenAI stream failed',
            model: request.model,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
            toolCount: request.tools?.length ?? 0,
          }),
        )

        return err(domainError)
      }
    },
  }
}
