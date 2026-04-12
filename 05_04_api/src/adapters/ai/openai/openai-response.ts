import type {
  Response,
  ResponseFunctionToolCall,
  ResponseFunctionWebSearch,
  ResponseOutputItem,
  ResponseOutputText,
  ResponseUsage,
} from 'openai/resources/responses/responses'

import { tryParseJson } from '../../../domain/ai/json-utils'
import { flattenReasoningSummaryText } from '../../../domain/ai/reasoning-summary'
import type {
  AiInteractionResponse,
  AiMessage,
  AiOutputItem,
  AiToolCall,
  AiUsage,
  AiWebReference,
  AiWebSearchActivity,
} from '../../../domain/ai/types'

export const normalizeToolCall = (toolCall: ResponseFunctionToolCall): AiToolCall => ({
  arguments: tryParseJson(toolCall.arguments),
  argumentsJson: toolCall.arguments,
  callId: toolCall.call_id,
  name: toolCall.name,
  providerItemId: toolCall.id,
})

const toDomainFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.trim()
    return hostname.length > 0 ? hostname : null
  } catch {
    return null
  }
}

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

const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const mergeWebSearchStatus = (
  current: AiWebSearchActivity['status'],
  next: AiWebSearchActivity['status'],
): AiWebSearchActivity['status'] => {
  const rank: Record<AiWebSearchActivity['status'], number> = {
    in_progress: 0,
    searching: 1,
    completed: 2,
    failed: 3,
  }

  return rank[next] >= rank[current] ? next : current
}

const toUrlCitationReference = (annotation: ResponseOutputText.URLCitation): AiWebReference => ({
  domain: toDomainFromUrl(annotation.url),
  title: annotation.title,
  url: annotation.url,
})

const collectOutputTextReferences = (items: ResponseOutputItem[]): AiWebReference[] => {
  const references: AiWebReference[] = []

  for (const item of items) {
    if (item.type !== 'message') {
      continue
    }

    for (const part of item.content) {
      if (part.type !== 'output_text') {
        continue
      }

      for (const annotation of part.annotations) {
        if (annotation.type === 'url_citation') {
          references.push(toUrlCitationReference(annotation))
        }
      }
    }
  }

  return dedupeWebReferences(references)
}

const toWebSearchSourceReferences = (item: ResponseFunctionWebSearch): AiWebReference[] => {
  if (item.action.type !== 'search' || !item.action.sources) {
    return []
  }

  return dedupeWebReferences(
    item.action.sources.map((source) => ({
      domain: toDomainFromUrl(source.url),
      title: null,
      url: source.url,
    })),
  )
}

export const createOpenAiWebSearchActivity = (input: {
  id: string
  responseId: string | null
  status: AiWebSearchActivity['status']
}): AiWebSearchActivity => ({
  id: input.id,
  patterns: [],
  provider: 'openai',
  queries: [],
  references: [],
  responseId: input.responseId,
  status: input.status,
  targetUrls: [],
})

export const updateOpenAiWebSearchActivityStatus = (
  current: AiWebSearchActivity | null,
  input: {
    id: string
    responseId: string | null
    status: AiWebSearchActivity['status']
  },
): AiWebSearchActivity => ({
  ...(current ??
    createOpenAiWebSearchActivity({
      id: input.id,
      responseId: input.responseId,
      status: input.status,
    })),
  responseId: current?.responseId ?? input.responseId,
  status: current ? mergeWebSearchStatus(current.status, input.status) : input.status,
})

export const mergeOpenAiWebSearchActivity = (
  current: AiWebSearchActivity | null,
  item: ResponseFunctionWebSearch,
  responseId: string | null,
): AiWebSearchActivity => {
  const nextBase =
    current ??
    createOpenAiWebSearchActivity({
      id: item.id,
      responseId,
      status: item.status,
    })

  const queries = [...nextBase.queries]
  const targetUrls = [...nextBase.targetUrls]
  const patterns = [...nextBase.patterns]

  if (item.action.type === 'search') {
    queries.push(...(item.action.queries ?? []))
    if (item.action.query.trim().length > 0) {
      queries.push(item.action.query)
    }
  }

  if (item.action.type === 'open_page' && typeof item.action.url === 'string') {
    targetUrls.push(item.action.url)
  }

  if (item.action.type === 'find_in_page') {
    if (item.action.pattern.trim().length > 0) {
      patterns.push(item.action.pattern)
    }
    if (item.action.url.trim().length > 0) {
      targetUrls.push(item.action.url)
    }
  }

  return {
    ...nextBase,
    patterns: dedupeStrings(patterns),
    queries: dedupeStrings(queries),
    references: dedupeWebReferences([...nextBase.references, ...toWebSearchSourceReferences(item)]),
    responseId,
    status: mergeWebSearchStatus(nextBase.status, item.status),
    targetUrls: dedupeStrings(targetUrls),
  }
}

const mapUsage = (usage: ResponseUsage | undefined): AiUsage | null => {
  if (!usage) {
    return null
  }

  return {
    cachedTokens: usage.input_tokens_details.cached_tokens,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens,
  }
}

const normalizeOutputItems = (items: ResponseOutputItem[]): AiOutputItem[] => {
  const output: AiOutputItem[] = []

  for (const item of items) {
    if (item.type === 'message') {
      const content: AiMessage['content'] = []

      for (const part of item.content) {
        if (part.type === 'output_text') {
          content.push({ text: part.text, type: 'text' })
          continue
        }

        content.push({ text: part.refusal, type: 'text' })
      }

      output.push({
        content,
        phase: item.phase ?? undefined,
        providerMessageId: item.id,
        role: 'assistant',
        type: 'message',
      })
      continue
    }

    if (item.type === 'function_call') {
      output.push({
        ...normalizeToolCall(item),
        type: 'function_call',
      })
      continue
    }

    if (item.type === 'reasoning') {
      const text = flattenReasoningSummaryText(item.summary)

      output.push({
        encryptedContent: item.encrypted_content ?? null,
        id: item.id,
        summary: item.summary,
        ...(text.length > 0 ? { text } : {}),
        type: 'reasoning',
      })
    }
  }

  return output
}

const normalizeMessages = (items: AiOutputItem[]): AiMessage[] => {
  const messages: AiMessage[] = []

  for (const item of items) {
    if (item.type !== 'message') {
      continue
    }

    messages.push({
      content: item.content,
      phase: item.phase,
      providerMessageId: item.providerMessageId,
      role: 'assistant',
    })
  }

  return messages
}

const normalizeWebSearches = (response: Response): AiWebSearchActivity[] => {
  const activitiesById = new Map<string, AiWebSearchActivity>()

  for (const item of response.output) {
    if (item.type !== 'web_search_call') {
      continue
    }

    const current = activitiesById.get(item.id) ?? null
    activitiesById.set(item.id, mergeOpenAiWebSearchActivity(current, item, response.id))
  }

  const activities = [...activitiesById.values()]
  const outputTextReferences = collectOutputTextReferences(response.output)

  if (activities.length === 0) {
    return outputTextReferences.length > 0
      ? [
          {
            ...createOpenAiWebSearchActivity({
              id: response.id ? `web_search:${response.id}` : 'web_search:openai',
              responseId: response.id,
              status: 'completed',
            }),
            references: outputTextReferences,
          },
        ]
      : []
  }

  if (outputTextReferences.length === 0) {
    return activities
  }

  const lastIndex = activities.length - 1

  return activities.map((activity, index) =>
    index === lastIndex
      ? {
          ...activity,
          references: dedupeWebReferences([...activity.references, ...outputTextReferences]),
        }
      : activity,
  )
}

export const normalizeResponse = (
  response: Response,
  requestId: string | null,
): AiInteractionResponse => {
  const output = normalizeOutputItems(response.output)
  const webSearches = normalizeWebSearches(response)

  return {
    messages: normalizeMessages(output),
    model: response.model,
    output,
    outputText: response.output_text ?? '',
    provider: 'openai',
    providerRequestId: requestId,
    raw: response,
    responseId: response.id,
    status: response.status ?? (response.error ? 'failed' : 'completed'),
    toolCalls: output.reduce<AiToolCall[]>((calls, item) => {
      if (item.type === 'function_call') {
        const { type: _type, ...toolCall } = item
        calls.push(toolCall)
      }

      return calls
    }, []),
    usage: mapUsage(response.usage),
    webSearches,
  }
}
