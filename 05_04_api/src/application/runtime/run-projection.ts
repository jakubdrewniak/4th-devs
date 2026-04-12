import { withTransaction } from '../../db/transaction'
import { createItemRepository, type ItemRecord } from '../../domain/runtime/item-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import {
  createSessionMessageRepository,
  type SessionMessageRecord,
} from '../../domain/sessions/session-message-repository'
import type { DomainError } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { asItemId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'

interface ProjectedSessionMessageProviderPayload {
  providerMessageId?: string | null
  responseId?: string | null
  sessionMessageId?: string | null
  source?: string | null
}

export const toProjectedItemRole = (
  authorKind: SessionMessageRecord['authorKind'],
): 'assistant' | 'system' | 'user' | null => {
  switch (authorKind) {
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'user':
      return 'user'
    case 'tool':
      return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readProjectedProviderPayload = (
  value: unknown,
): ProjectedSessionMessageProviderPayload | null => (isRecord(value) ? value : null)

const readProjectedSessionMessageId = (item: ItemRecord): string | null => {
  if (item.type !== 'message') {
    return null
  }

  const payload = readProjectedProviderPayload(item.providerPayload)
  return payload?.source === 'session_message_projection' &&
    typeof payload.sessionMessageId === 'string' &&
    payload.sessionMessageId.length > 0
    ? payload.sessionMessageId
    : null
}

const readResponseId = (value: unknown): string | null => {
  const payload = readProjectedProviderPayload(value)
  return typeof payload?.responseId === 'string' && payload.responseId.length > 0
    ? payload.responseId
    : null
}

const isProjectionOnlyThreadContext = (items: ItemRecord[]): boolean => {
  if (items.length === 0) {
    return true
  }

  let projectedMessageCount = 0

  for (const item of items) {
    if (item.type === 'message') {
      if (!readProjectedSessionMessageId(item)) {
        return false
      }

      projectedMessageCount += 1
      continue
    }

    if (item.type !== 'reasoning') {
      return false
    }
  }

  return projectedMessageCount > 0
}

export const projectVisibleMessagesToRunItems = (
  context: CommandContext,
  input: {
    existingItems?: ItemRecord[]
    messages: SessionMessageRecord[]
    runId: RunId
  },
): CommandResult<null> =>
  withTransaction(context.db, (tx) => {
    const itemRepository = createItemRepository(tx)
    const sourceRunItems = new Map<RunId, ItemRecord[]>()
    const existingItems = input.existingItems ?? []
    const projectedSessionMessageIds = new Set<string>()
    const replayedResponseIds = new Set<string>()
    let sequence = (existingItems.at(-1)?.sequence ?? 0) + 1

    for (const existingItem of existingItems) {
      const sessionMessageId = readProjectedSessionMessageId(existingItem)

      if (sessionMessageId) {
        projectedSessionMessageIds.add(sessionMessageId)
      }

      const responseId = readResponseId(existingItem.providerPayload)

      if (responseId) {
        replayedResponseIds.add(responseId)
      }
    }

    const getSourceRunItems = (sourceRunId: RunId): Result<ItemRecord[], DomainError> => {
      const cached = sourceRunItems.get(sourceRunId)

      if (cached) {
        return ok(cached)
      }

      const sourceItemsResult = itemRepository.listByRunId(context.tenantScope, sourceRunId)

      if (!sourceItemsResult.ok) {
        return sourceItemsResult
      }

      sourceRunItems.set(sourceRunId, sourceItemsResult.value)

      return sourceItemsResult
    }

    for (const message of input.messages) {
      if (projectedSessionMessageIds.has(message.id)) {
        continue
      }

      const role = toProjectedItemRole(message.authorKind)

      if (!role || message.content.length === 0) {
        continue
      }

      const metadata = message.metadata as {
        responseId?: string | null
        providerMessageId?: string | null
      } | null

      const responseId =
        typeof metadata?.responseId === 'string' && metadata.responseId.length > 0
          ? metadata.responseId
          : null

      if (responseId && !replayedResponseIds.has(responseId) && message.runId) {
        const sourceItemsResult = getSourceRunItems(message.runId)

        if (!sourceItemsResult.ok) {
          return sourceItemsResult
        }

        const sourceItems = sourceItemsResult.value

        for (const sourceItem of sourceItems) {
          if (sourceItem.type !== 'reasoning') {
            continue
          }

          const providerPayload = sourceItem.providerPayload as {
            provider?: string | null
            responseId?: string | null
          } | null

          if (providerPayload?.provider !== 'openai' || providerPayload.responseId !== responseId) {
            continue
          }

          const reasoningResult = itemRepository.createReasoning(context.tenantScope, {
            createdAt: sourceItem.createdAt,
            id: asItemId(context.services.ids.create('itm')),
            providerPayload: sourceItem.providerPayload,
            runId: input.runId,
            sequence,
            summary: sourceItem.summary,
          })

          if (!reasoningResult.ok) {
            return reasoningResult
          }

          sequence += 1
        }

        replayedResponseIds.add(responseId)
      }

      let projectedContent = message.content

      if (role === 'assistant' && message.runId) {
        const sourceItemsResult = getSourceRunItems(message.runId)

        if (!sourceItemsResult.ok) {
          return sourceItemsResult
        }

        const matchedSourceItem = sourceItemsResult.value.find((sourceItem) => {
          if (
            sourceItem.type !== 'message' ||
            sourceItem.role !== 'assistant' ||
            !sourceItem.content ||
            sourceItem.content.length === 0
          ) {
            return false
          }

          const sourceProviderPayload = sourceItem.providerPayload as {
            providerMessageId?: string | null
            responseId?: string | null
          } | null

          if (
            metadata?.providerMessageId &&
            sourceProviderPayload?.providerMessageId === metadata.providerMessageId
          ) {
            return true
          }

          return Boolean(
            responseId &&
              sourceProviderPayload?.responseId === responseId &&
              sourceItem.content.some((part) =>
                message.content.some((messagePart) => messagePart.text === part.text),
              ),
          )
        })

        if (matchedSourceItem?.content && matchedSourceItem.content.length > 0) {
          projectedContent = matchedSourceItem.content
        }
      }

      const itemId = asItemId(context.services.ids.create('itm'))
      const itemResult = itemRepository.createMessage(context.tenantScope, {
        content: projectedContent,
        createdAt: message.createdAt,
        id: itemId,
        providerPayload: {
          providerMessageId: metadata?.providerMessageId ?? null,
          responseId,
          sessionMessageId: message.id,
          source: 'session_message_projection',
        },
        role,
        runId: input.runId,
        sequence,
      })

      if (!itemResult.ok) {
        return itemResult
      }

      sequence += 1
    }

    return ok(null)
  })

export const listVisibleMessages = (
  context: CommandContext,
  run: RunRecord,
): Result<SessionMessageRecord[], DomainError> => {
  if (!run.threadId) {
    return run.parentRunId !== null
      ? ok([])
      : err({
          message: `run ${run.id} is missing a thread binding`,
          type: 'conflict',
        })
  }

  const sessionMessageRepository = createSessionMessageRepository(context.db)
  return sessionMessageRepository.listByThreadId(context.tenantScope, run.threadId)
}

export const listRunItems = (
  context: CommandContext,
  runId: RunId,
): Result<ItemRecord[], DomainError> =>
  createItemRepository(context.db).listByRunId(context.tenantScope, runId)

export const ensureProjectedThreadContext = (
  context: CommandContext,
  run: RunRecord,
  visibleMessages: SessionMessageRecord[],
): Result<ItemRecord[], DomainError> => {
  const existingItems = listRunItems(context, run.id)

  if (!existingItems.ok) {
    return existingItems
  }

  if (!isProjectionOnlyThreadContext(existingItems.value)) {
    return existingItems
  }

  const projection = projectVisibleMessagesToRunItems(context, {
    existingItems: existingItems.value,
    messages: visibleMessages,
    runId: run.id,
  })

  if (!projection.ok) {
    return projection
  }

  return listRunItems(context, run.id)
}
