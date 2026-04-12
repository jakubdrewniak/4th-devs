import { Hono } from 'hono'
import { z } from 'zod'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createResourceAccessService } from '../../../../application/access/resource-access'
import {
  isNativeToolAllowedForRun,
  isToolAllowedForRun,
} from '../../../../application/agents/agent-runtime-policy'
import {
  createBranchThreadCommand,
  parseBranchThreadInput,
} from '../../../../application/commands/branch-thread'
import { createDeleteThreadCommand } from '../../../../application/commands/delete-thread'
import {
  createEditThreadMessageCommand,
  parseEditThreadMessageInput,
} from '../../../../application/commands/edit-thread-message'
import { createEventStore } from '../../../../application/commands/event-store'
import { createExecuteRunCommand } from '../../../../application/commands/execute-run'
import {
  createPostThreadMessageCommand,
  parsePostThreadMessageInput,
} from '../../../../application/commands/post-thread-message'
import {
  createStartThreadInteractionCommand,
  parseStartThreadInteractionInput,
  type StartThreadInteractionInput,
  type StartThreadInteractionOutput,
} from '../../../../application/commands/start-thread-interaction'
import { assembleThreadInteractionRequest } from '../../../../application/interactions/assemble-thread-interaction-request'
import { applyLatestBudgetCalibration } from '../../../../application/interactions/context-bundle'
import { loadThreadContext } from '../../../../application/interactions/load-thread-context'
import { estimateObservationTokenCount } from '../../../../application/memory/observe-summary'
import { estimateReflectionTokenCount } from '../../../../application/memory/reflect-run-local-memory'
import {
  appendThreadNamingRequestedEvent,
  appendThreadUpdatedEvent,
} from '../../../../application/naming/thread-title-events'
import { loadThreadRootJobReadModel } from '../../../../application/runtime/job-read-model'
import { rebuildRunExecutionOutput } from '../../../../application/runtime/rebuild-run-execution-output'
import { recoverExecuteRunOutput } from '../../../../application/runtime/run-command-recovery'
import type { RunExecutionOutput } from '../../../../application/runtime/run-persistence'
import {
  compareThreadActivityReadModels,
  loadThreadActivityReadModel,
} from '../../../../application/runtime/thread-activity-read-model'
import { toToolContext } from '../../../../application/runtime/run-tool-execution'
import { resolveContextWindowForModel } from '../../../../application/system/models-catalog'
import { withTransaction } from '../../../../db/transaction'
import { createUsageLedgerRepository } from '../../../../domain/ai/usage-ledger-repository'
import {
  createMemoryRecordRepository,
  type MemoryRecordRecord,
  type ObservationMemoryContent,
  type ReflectionMemoryContent,
} from '../../../../domain/memory/memory-record-repository'
import type { HttpIdempotencyKeyRecord } from '../../../../domain/operations/http-idempotency-key-repository'
import { createRunRepository } from '../../../../domain/runtime/run-repository'
import { createSessionMessageRepository } from '../../../../domain/sessions/session-message-repository'
import { createSessionThreadRepository } from '../../../../domain/sessions/session-thread-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asRunId, asSessionMessageId, asSessionThreadId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import {
  maybeHandleIdempotentJsonRoute,
  recoverRecordedIdempotentProgress,
} from '../../idempotency'
import {
  postThreadMessageOutputSchema,
  sessionThreadRecordSchema,
  startThreadInteractionOutputSchema,
} from '../../idempotency-response-schemas'
import { parseJsonBody } from '../../parse-json-body'

const toCommandContext = (c: Parameters<typeof requireTenantScope>[0]) => ({
  config: c.get('config'),
  db: c.get('db'),
  requestId: c.get('requestId'),
  services: c.get('services'),
  tenantScope: requireTenantScope(c),
  traceId: c.get('traceId'),
})

const listThreadsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  query: z.string().trim().max(200).optional(),
})

const listThreadActivityQuerySchema = z.object({
  completed_within_minutes: z.coerce.number().int().min(0).max(10_080).optional(),
})

const renameThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
})

const updateObservationMemoryBodySchema = z.object({
  kind: z.literal('observation'),
  observations: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(8),
})

const updateReflectionMemoryBodySchema = z.object({
  kind: z.literal('reflection'),
  reflection: z.string().trim().min(1).max(4_000),
})

const updateThreadMemoryBodySchema = z.discriminatedUnion('kind', [
  updateObservationMemoryBodySchema,
  updateReflectionMemoryBodySchema,
])

const threadInteractionRecoverySnapshotSchema = z.object({
  attachedFileIds: z.array(z.string().trim().min(1).max(200)),
  inputMessageId: z.string().trim().min(1).max(200),
  kind: z.literal('thread_interaction_started'),
  runId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(200),
})

const buildThreadInteractionRecoverySnapshot = (output: StartThreadInteractionOutput) => ({
  attachedFileIds: output.attachedFileIds,
  inputMessageId: output.messageId,
  kind: 'thread_interaction_started' as const,
  runId: output.runId,
  sessionId: output.sessionId,
  threadId: output.threadId,
})

const toThreadInteractionSuccess = (
  snapshot: z.infer<typeof threadInteractionRecoverySnapshotSchema>,
  output: RunExecutionOutput,
) =>
  ({
    data: {
      attachedFileIds: snapshot.attachedFileIds,
      ...output,
      inputMessageId: snapshot.inputMessageId,
      sessionId: snapshot.sessionId,
      threadId: snapshot.threadId,
    },
    status: output.status === 'waiting' ? 202 : 201,
  }) as const

const toThreadExecuteOverrides = (input: StartThreadInteractionInput) => ({
  maxOutputTokens: input.maxOutputTokens,
  model: input.model,
  modelAlias: input.modelAlias,
  provider: input.provider,
  reasoning: input.reasoning,
  temperature: input.temperature,
})

const toThreadMemoryObservationRecord = (record: MemoryRecordRecord) => ({
  content: record.content,
  createdAt: record.createdAt,
  id: record.id,
  kind: 'observation' as const,
  tokenCount: record.tokenCount,
})

const toThreadMemoryReflectionRecord = (record: MemoryRecordRecord) => ({
  content: record.content,
  createdAt: record.createdAt,
  generation: record.generation,
  id: record.id,
  kind: 'reflection' as const,
  tokenCount: record.tokenCount,
})

export const createThreadRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const branchThreadCommand = createBranchThreadCommand()
  const deleteThreadCommand = createDeleteThreadCommand()
  const editThreadMessageCommand = createEditThreadMessageCommand()
  const executeRunCommand = createExecuteRunCommand()
  const postThreadMessageCommand = createPostThreadMessageCommand()
  const startThreadInteractionCommand = createStartThreadInteractionCommand()

  routes.get('/', async (c) => {
    const parsed = listThreadsQuerySchema.safeParse({
      limit: c.req.query('limit'),
      query: c.req.query('query') ?? undefined,
    })

    if (!parsed.success) {
      throw new DomainErrorException({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const tenantScope = requireTenantScope(c)
    const threadRepository = createSessionThreadRepository(c.get('db'))
    const result = threadRepository.listVisibleByAccount(tenantScope, {
      limit: parsed.data.limit ?? 50,
      query: parsed.data.query,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    const threadsWithGraph = result.value.map((thread) => {
      const rootJob = loadThreadRootJobReadModel(c.get('db'), tenantScope, thread.id)

      if (!rootJob.ok) {
        throw new DomainErrorException(rootJob.error)
      }

      return {
        ...thread,
        rootJob: rootJob.value,
      }
    })

    return c.json(successEnvelope(c, { threads: threadsWithGraph }), 200)
  })

  routes.get('/activity', async (c) => {
    const parsed = listThreadActivityQuerySchema.safeParse({
      completed_within_minutes: c.req.query('completed_within_minutes') ?? undefined,
    })

    if (!parsed.success) {
      throw new DomainErrorException({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const tenantScope = requireTenantScope(c)
    const threadRepository = createSessionThreadRepository(c.get('db'))
    const result = threadRepository.listRootVisibleByAccount(tenantScope)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    const nowIso = c.get('services').clock.nowIso()
    const completedWithinMinutes = parsed.data.completed_within_minutes ?? 30
    const threadsWithActivity = result.value
      .map((thread) => {
        const activity = loadThreadActivityReadModel(c.get('db'), tenantScope, thread.id, {
          completedWithinMinutes,
          nowIso,
        })

        if (!activity.ok) {
          throw new DomainErrorException(activity.error)
        }

        if (!activity.value) {
          return null
        }

        return {
          activity: activity.value,
          id: thread.id,
          title: thread.title,
        }
      })
      .filter((thread): thread is NonNullable<typeof thread> => thread !== null)
      .sort((left, right) => {
        const activityDelta = compareThreadActivityReadModels(left.activity, right.activity)

        if (activityDelta !== 0) {
          return activityDelta
        }

        return right.id.localeCompare(left.id)
      })
      .slice(0, 10)

    return c.json(successEnvelope(c, { threads: threadsWithActivity }), 200)
  })

  routes.get('/:threadId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const resourceAccess = createResourceAccessService(c.get('db'))
    const result = resourceAccess.requireThreadAccess(
      tenantScope,
      asSessionThreadId(c.req.param('threadId')),
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    const rootJob = loadThreadRootJobReadModel(c.get('db'), tenantScope, result.value.thread.id)

    if (!rootJob.ok) {
      throw new DomainErrorException(rootJob.error)
    }

    return c.json(
      successEnvelope(c, {
        ...result.value.thread,
        rootJob: rootJob.value,
      }),
      200,
    )
  })

  routes.get('/:threadId/messages', async (c) => {
    const tenantScope = requireTenantScope(c)
    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.requireThreadAccess(
      tenantScope,
      asSessionThreadId(c.req.param('threadId')),
    )

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const sessionMessageRepository = createSessionMessageRepository(c.get('db'))
    const result = sessionMessageRepository.listByThreadId(
      tenantScope,
      authorizedThread.value.thread.id,
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/:threadId/budget', async (c) => {
    const tenantScope = requireTenantScope(c)
    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.requireThreadAccess(
      tenantScope,
      asSessionThreadId(c.req.param('threadId')),
    )

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const usageLedgerRepository = createUsageLedgerRepository(c.get('db'))
    const latestBudget = usageLedgerRepository.getLatestThreadInteractionBudget(
      tenantScope,
      authorizedThread.value.thread.id,
    )

    if (!latestBudget.ok) {
      throw new DomainErrorException(latestBudget.error)
    }

    const runRepository = createRunRepository(c.get('db'))
    const threadRuns = runRepository.listByThreadId(tenantScope, authorizedThread.value.thread.id)

    if (!threadRuns.ok) {
      throw new DomainErrorException(threadRuns.error)
    }

    const latestRootRun = threadRuns.value.filter((run) => run.parentRunId === null).at(-1) ?? null

    if (!latestRootRun) {
      return c.json(successEnvelope(c, { budget: null }), 200)
    }

    const loadedContext = await loadThreadContext(toCommandContext(c), latestRootRun, {
      compact: true,
      observe: false,
      reflect: false,
    })

    if (!loadedContext.ok) {
      throw new DomainErrorException(loadedContext.error)
    }

    const activeTools = c
      .get('services')
      .tools.list(toToolContext(toCommandContext(c), latestRootRun))
      .filter((tool) => isToolAllowedForRun(c.get('db'), tenantScope, latestRootRun, tool))
    const nativeTools = isNativeToolAllowedForRun(
      c.get('db'),
      tenantScope,
      latestRootRun,
      'web_search',
    )
      ? (['web_search'] as const)
      : []
    const assembled = assembleThreadInteractionRequest({
      activeTools,
      context: loadedContext.value,
      nativeTools: [...nativeTools],
      overrides: {},
    })
    const calibratedBudget = applyLatestBudgetCalibration(
      assembled.bundle.budget,
      latestBudget.value
        ? {
            latestActualInputTokens: latestBudget.value.inputTokens,
            latestCachedTokens: latestBudget.value.cachedTokens,
            latestEstimatedInputTokens: latestBudget.value.estimatedInputTokens,
          }
        : null,
    )
    const rebuiltExecution = rebuildRunExecutionOutput(toCommandContext(c), latestRootRun)

    if (!rebuiltExecution.ok) {
      throw new DomainErrorException(rebuiltExecution.error)
    }

    const actualUsage = rebuiltExecution.value?.usage ?? null
    const actualInputTokens = actualUsage?.inputTokens ?? latestBudget.value?.inputTokens ?? null
    const actualOutputTokens = actualUsage?.outputTokens ?? latestBudget.value?.outputTokens ?? null

    return c.json(
      successEnvelope(c, {
        budget: {
          actualInputTokens,
          actualOutputTokens,
          actualTotalTokens:
            actualUsage?.totalTokens ??
            (actualInputTokens !== null && actualOutputTokens !== null
              ? actualInputTokens + actualOutputTokens
              : null),
          cachedInputTokens: actualUsage?.cachedTokens ?? latestBudget.value?.cachedTokens ?? null,
          contextWindow: resolveContextWindowForModel(
            assembled.request.model ??
              latestBudget.value?.model ??
              c.get('config').ai.defaults.model,
          ),
          estimatedInputTokens: calibratedBudget.rawEstimatedInputTokens,
          measuredAt: latestBudget.value?.createdAt ?? null,
          model: latestBudget.value?.model ?? assembled.request.model ?? null,
          provider: latestBudget.value?.provider ?? assembled.request.provider ?? null,
          reasoningTokens: actualUsage?.reasoningTokens ?? null,
          reservedOutputTokens: calibratedBudget.reservedOutputTokens,
          stablePrefixTokens: calibratedBudget.stablePrefixTokens,
          turn: latestRootRun.turnCount + 1,
          volatileSuffixTokens: calibratedBudget.volatileSuffixTokens,
        },
      }),
      200,
    )
  })

  routes.patch('/:threadId', async (c) => {
    const parsedInput = renameThreadBodySchema.safeParse(await parseJsonBody(c))
    const tenantScope = requireTenantScope(c)
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.success) {
      throw new DomainErrorException({
        message: parsedInput.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.authorizeThreadWrite(tenantScope, threadId)

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const commandContext = toCommandContext(c)
    const result = withTransaction(c.get('db'), (tx) => {
      const threadRepository = createSessionThreadRepository(tx)
      const eventStore = createEventStore(tx)
      const updatedThread = threadRepository.update(tenantScope, authorizedThread.value.thread.id, {
        title: parsedInput.data.title,
        titleSource: 'manual',
        updatedAt: commandContext.services.clock.nowIso(),
      })

      if (!updatedThread.ok) {
        return updatedThread
      }

      appendThreadUpdatedEvent(commandContext, eventStore, {
        sessionId: updatedThread.value.sessionId,
        threadId: updatedThread.value.id,
        title: updatedThread.value.title,
        titleSource: updatedThread.value.titleSource,
        updatedAt: updatedThread.value.updatedAt,
      })

      return updatedThread
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.post('/:threadId/title/regenerate', async (c) => {
    const tenantScope = requireTenantScope(c)
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.authorizeThreadWrite(tenantScope, threadId)

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const runRepository = createRunRepository(c.get('db'))
    const threadRuns = runRepository.listByThreadId(tenantScope, authorizedThread.value.thread.id)

    if (!threadRuns.ok) {
      throw new DomainErrorException(threadRuns.error)
    }

    const latestRootRun = threadRuns.value.filter((run) => run.parentRunId === null).at(-1) ?? null

    if (!latestRootRun) {
      throw new DomainErrorException({
        message: `thread ${authorizedThread.value.thread.id} does not have a root run to derive a title from`,
        type: 'conflict',
      })
    }

    const commandContext = toCommandContext(c)
    const eventStore = createEventStore(c.get('db'))
    const requestedAt = commandContext.services.clock.nowIso()

    appendThreadNamingRequestedEvent(commandContext, eventStore, {
      requestId: commandContext.services.ids.create('tnr'),
      requestedAt,
      sessionId: authorizedThread.value.thread.sessionId,
      sourceRunId: latestRootRun.id,
      threadId: authorizedThread.value.thread.id,
      trigger: 'manual_regenerate',
    })

    return c.json(
      successEnvelope(c, {
        accepted: true,
        threadId: authorizedThread.value.thread.id,
      }),
      202,
    )
  })

  routes.delete('/:threadId', async (c) => {
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const result = await deleteThreadCommand.execute(toCommandContext(c), threadId)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(c, {
        deleted: true,
        threadId: result.value.threadId,
      }),
      200,
    )
  })

  routes.post('/:threadId/branches', async (c) => {
    const parsedInput = parseBranchThreadInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async (idempotency) => {
        const result = branchThreadCommand.execute(toCommandContext(c), threadId, parsedInput.value)

        if (!result.ok) {
          throw new DomainErrorException(result.error)
        }

        idempotency?.recordProgress(result.value)

        return {
          data: result.value,
          status: 201,
        }
      },
      parseReplayData: (value) => sessionThreadRecordSchema.parse(value),
      recoverInProgress: ({ record }) =>
        recoverRecordedIdempotentProgress({
          parse: (value) => sessionThreadRecordSchema.parse(value),
          record,
          status: 201,
        }),
      requestBody: {
        sourceThreadId: threadId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/threads/${threadId}/branches`,
    })
  })

  routes.post('/:threadId/messages', async (c) => {
    const parsedInput = parsePostThreadMessageInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async (idempotency) => {
        const result = postThreadMessageCommand.execute(
          toCommandContext(c),
          threadId,
          parsedInput.value,
        )

        if (!result.ok) {
          throw new DomainErrorException(result.error)
        }

        idempotency?.recordProgress(result.value)

        return {
          data: result.value,
          status: 201,
        }
      },
      parseReplayData: (value) => postThreadMessageOutputSchema.parse(value),
      recoverInProgress: ({ record }) =>
        recoverRecordedIdempotentProgress({
          parse: (value) => postThreadMessageOutputSchema.parse(value),
          record,
          status: 201,
        }),
      requestBody: {
        threadId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/threads/${threadId}/messages`,
    })
  })

  routes.patch('/:threadId/messages/:messageId', async (c) => {
    const parsedInput = parseEditThreadMessageInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const messageId = asSessionMessageId(c.req.param('messageId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const result = await editThreadMessageCommand.execute(toCommandContext(c), {
      input: parsedInput.value,
      messageId,
      threadId,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.post('/:threadId/interactions', async (c) => {
    const parsedInput = parseStartThreadInteractionInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async (idempotency) => {
        const commandContext = toCommandContext(c)
        const startResult = startThreadInteractionCommand.execute(
          commandContext,
          threadId,
          parsedInput.value,
        )

        if (!startResult.ok) {
          throw new DomainErrorException(startResult.error)
        }

        const snapshot = buildThreadInteractionRecoverySnapshot(startResult.value)
        const executeOverrides = toThreadExecuteOverrides(parsedInput.value)

        idempotency?.recordProgress(snapshot)

        const executeResult = await executeRunCommand.execute(
          commandContext,
          asRunId(startResult.value.runId),
          executeOverrides,
        )

        if (!executeResult.ok) {
          if (executeResult.error.type === 'conflict') {
            const recovered = await recoverExecuteRunOutput({
              command: executeRunCommand,
              context: commandContext,
              executeInput: executeOverrides,
              runId: asRunId(snapshot.runId),
            })

            if (!recovered.ok) {
              throw new DomainErrorException(recovered.error)
            }

            if (recovered.value) {
              return toThreadInteractionSuccess(snapshot, recovered.value)
            }
          }

          throw new DomainErrorException(executeResult.error)
        }

        return toThreadInteractionSuccess(snapshot, executeResult.value)
      },
      parseReplayData: (value) => startThreadInteractionOutputSchema.parse(value),
      recoverInProgress: async ({ record }: { record: HttpIdempotencyKeyRecord }) => {
        const snapshot = threadInteractionRecoverySnapshotSchema.safeParse(record.responseDataJson)

        if (!snapshot.success) {
          return null
        }

        const commandContext = toCommandContext(c)
        const executeOverrides = toThreadExecuteOverrides(parsedInput.value)
        const recovered = await recoverExecuteRunOutput({
          command: executeRunCommand,
          context: commandContext,
          executeInput: executeOverrides,
          runId: asRunId(snapshot.data.runId),
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return toThreadInteractionSuccess(snapshot.data, recovered.value)
      },
      requestBody: {
        threadId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/threads/${threadId}/interactions`,
    })
  })

  routes.get('/:threadId/memory', async (c) => {
    const tenantScope = requireTenantScope(c)
    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.requireThreadAccess(
      tenantScope,
      asSessionThreadId(c.req.param('threadId')),
    )

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const memoryRepo = createMemoryRecordRepository(c.get('db'))
    const threadId = authorizedThread.value.thread.id

    const allRecords = memoryRepo.listActiveByThread(tenantScope, threadId)

    if (!allRecords.ok) {
      throw new DomainErrorException(allRecords.error)
    }

    const observations = allRecords.value
      .filter((r) => r.kind === 'observation')
      .map(toThreadMemoryObservationRecord)

    const reflectionRecord =
      allRecords.value
        .filter((r) => r.kind === 'reflection')
        .sort((a, b) => b.generation - a.generation)[0] ?? null

    return c.json(
      successEnvelope(c, {
        observations,
        reflection: reflectionRecord ? toThreadMemoryReflectionRecord(reflectionRecord) : null,
      }),
      200,
    )
  })

  routes.patch('/:threadId/memory/:recordId', async (c) => {
    const parsedInput = updateThreadMemoryBodySchema.safeParse(await parseJsonBody(c))
    const tenantScope = requireTenantScope(c)
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.success) {
      throw new DomainErrorException({
        message: parsedInput.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const resourceAccess = createResourceAccessService(c.get('db'))
    const authorizedThread = resourceAccess.authorizeThreadWrite(tenantScope, threadId)

    if (!authorizedThread.ok) {
      throw new DomainErrorException(authorizedThread.error)
    }

    const memoryRepo = createMemoryRecordRepository(c.get('db'))
    const allRecords = memoryRepo.listActiveByThread(tenantScope, authorizedThread.value.thread.id)

    if (!allRecords.ok) {
      throw new DomainErrorException(allRecords.error)
    }

    const record = allRecords.value.find((entry) => entry.id === c.req.param('recordId'))

    if (!record) {
      throw new DomainErrorException({
        message: `memory record ${c.req.param('recordId')} was not found`,
        type: 'not_found',
      })
    }

    if (parsedInput.data.kind === 'observation') {
      if (record.kind !== 'observation') {
        throw new DomainErrorException({
          message: 'memory record kind does not match observation update input',
          type: 'validation',
        })
      }

      const existingContent = record.content as ObservationMemoryContent
      const nextContent: ObservationMemoryContent = {
        observations: parsedInput.data.observations,
        source: existingContent.source === 'observer_v1' ? existingContent.source : 'observer_v1',
      }
      const updated = memoryRepo.updateContent(tenantScope, record.id, {
        content: nextContent,
        tokenCount: estimateObservationTokenCount(nextContent),
      })

      if (!updated.ok) {
        throw new DomainErrorException(updated.error)
      }

      return c.json(
        successEnvelope(c, {
          record: toThreadMemoryObservationRecord(updated.value),
        }),
        200,
      )
    }

    if (record.kind !== 'reflection') {
      throw new DomainErrorException({
        message: 'memory record kind does not match reflection update input',
        type: 'validation',
      })
    }

    const existingContent = record.content as ReflectionMemoryContent
    const nextContent: ReflectionMemoryContent = {
      reflection: parsedInput.data.reflection,
      source: existingContent.source === 'reflector_v1' ? existingContent.source : 'reflector_v1',
    }
    const updated = memoryRepo.updateContent(tenantScope, record.id, {
      content: nextContent,
      tokenCount: estimateReflectionTokenCount(nextContent),
    })

    if (!updated.ok) {
      throw new DomainErrorException(updated.error)
    }

    return c.json(
      successEnvelope(c, {
        record: toThreadMemoryReflectionRecord(updated.value),
      }),
      200,
    )
  })

  return routes
}
