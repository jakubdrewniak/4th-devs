import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import { createJobRepository } from '../../domain/runtime/job-repository'
import { createRunRepository } from '../../domain/runtime/run-repository'
import { createSessionMessageRepository } from '../../domain/sessions/session-message-repository'
import { createSessionThreadRepository } from '../../domain/sessions/session-thread-repository'
import { createWorkSessionRepository } from '../../domain/sessions/work-session-repository'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { RunId, SessionMessageId, SessionThreadId, WorkSessionId } from '../../shared/ids'
import {
  asJobId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asWorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { resolveRootRunAgentBinding } from '../agents/root-run-agent-binding'
import {
  resolveRootRunTargetSelection,
  rootRunTargetInputSchema,
} from '../agents/root-run-target-input'
import { appendThreadNamingRequestedEvent } from '../naming/thread-title-events'
import { appendJobCreatedEvents } from '../runtime/job-events'
import { buildSessionBootstrapJobQueueReason } from '../runtime/job-status-reasons'
import { appendWorkspaceLifecycleEvents } from '../workspaces/workspace-events'
import { createWorkspaceService } from '../workspaces/workspace-service'
import type { CommandContext, CommandResult } from './command-context'
import { createEventStore } from './event-store'

const bootstrapSessionInputSchema = z.object({
  execute: z.boolean().optional(),
  initialMessage: z.string().trim().min(1).max(10_000),
  maxOutputTokens: z.number().int().positive().max(100_000).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  model: z.string().trim().min(1).max(200).optional(),
  modelAlias: z.string().trim().min(1).max(200).optional(),
  provider: z.enum(['openai', 'google']).optional(),
  reasoning: z
    .object({
      effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
      summary: z.enum(['auto', 'concise', 'detailed']).optional(),
    })
    .optional(),
  task: z.string().trim().min(1).max(10_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  target: rootRunTargetInputSchema.optional(),
  threadTitle: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().min(1).max(200).nullable().optional(),
  workspaceRef: z.string().trim().min(1).max(500).nullable().optional(),
})

export type BootstrapSessionInput = z.infer<typeof bootstrapSessionInputSchema>

export interface BootstrapSessionOutput {
  messageId: SessionMessageId
  runId: RunId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

export const parseBootstrapSessionInput = (
  input: unknown,
): CommandResult<BootstrapSessionInput> => {
  const parsed = bootstrapSessionInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createBootstrapSessionCommand = () => ({
  execute: (
    context: CommandContext,
    input: BootstrapSessionInput,
  ): CommandResult<BootstrapSessionOutput> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
      }

      const targetSelection = resolveRootRunTargetSelection({ target: input.target })

      const agentBinding = resolveRootRunAgentBinding(context.db, context.tenantScope, {
        agentId: targetSelection.agentId,
        useAccountDefaultAgent: targetSelection.useAccountDefaultAgent,
      })

      if (!agentBinding.ok) {
        return agentBinding
      }

      return withTransaction(context.db, (tx) => {
        const workSessionRepository = createWorkSessionRepository(tx)
        const sessionThreadRepository = createSessionThreadRepository(tx)
        const sessionMessageRepository = createSessionMessageRepository(tx)
        const runRepository = createRunRepository(tx)
        const eventStore = createEventStore(tx)

        const now = context.services.clock.nowIso()
        const sessionId = asWorkSessionId(context.services.ids.create('ses'))
        const threadId = asSessionThreadId(context.services.ids.create('thr'))
        const messageId = asSessionMessageId(context.services.ids.create('msg'))
        const runId = asRunId(context.services.ids.create('run'))
        const jobId = asJobId(context.services.ids.create('job'))
        const content = [{ text: input.initialMessage, type: 'text' as const }]
        const sessionTitle = input.title ?? null
        const threadTitle = input.threadTitle ?? sessionTitle
        const workspaceService = createWorkspaceService(tx, {
          createId: context.services.ids.create,
          fileStorageRoot: context.config.files.storage.root,
        })
        const workspaceResolution = unwrapOrThrow(
          workspaceService.ensureAccountWorkspaceResolution(context.tenantScope, {
            nowIso: now,
          }),
        )
        const workspace = workspaceResolution.workspace
        const sessionWorkspaceRef = workspaceService.ensureSessionRef(workspace, sessionId)
        const runWorkspaceRef = workspaceService.ensureRunRef(workspace, runId)

        const createdSession = unwrapOrThrow(
          workSessionRepository.create(context.tenantScope, {
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: sessionId,
            metadata: input.metadata ?? null,
            status: 'active',
            title: sessionTitle,
            updatedAt: now,
            workspaceId: workspace.id,
            workspaceRef: sessionWorkspaceRef,
          }),
        )

        unwrapOrThrow(
          sessionThreadRepository.create(context.tenantScope, {
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: threadId,
            sessionId,
            title: threadTitle,
            titleSource: threadTitle ? 'manual' : null,
            updatedAt: now,
          }),
        )

        const createdJob = unwrapOrThrow(
          createJobRepository(tx).create(context.tenantScope, {
            assignedAgentId: agentBinding.value.agentId,
            assignedAgentRevisionId: agentBinding.value.agentRevisionId,
            createdAt: now,
            currentRunId: runId,
            id: jobId,
            inputJson: {
              messageId,
              source: 'session.bootstrap',
              task: input.task ?? input.initialMessage,
            },
            kind: 'objective',
            lastSchedulerSyncAt: now,
            queuedAt: now,
            rootJobId: jobId,
            sessionId,
            statusReasonJson: buildSessionBootstrapJobQueueReason({
              runId,
            }),
            status: 'queued',
            threadId,
            title: input.task ?? input.initialMessage,
            updatedAt: now,
          }),
        )

        unwrapOrThrow(
          runRepository.create(context.tenantScope, {
            actorAccountId: context.tenantScope.accountId,
            agentId: agentBinding.value.agentId,
            agentRevisionId: agentBinding.value.agentRevisionId,
            configSnapshot: {
              apiBasePath: context.config.api.basePath,
              model: agentBinding.value.resolvedConfigSnapshot.model,
              modelAlias: agentBinding.value.resolvedConfigSnapshot.modelAlias,
              provider: agentBinding.value.resolvedConfigSnapshot.provider,
              reasoning: agentBinding.value.resolvedConfigSnapshot.reasoning,
              version: context.config.api.version,
            },
            createdAt: now,
            id: runId,
            rootRunId: runId,
            sessionId,
            startedAt: now,
            task: input.task ?? input.initialMessage,
            targetKind: agentBinding.value.targetKind,
            threadId,
            toolProfileId: agentBinding.value.toolProfileId,
            jobId,
            workspaceId: workspace.id,
            workspaceRef: runWorkspaceRef,
          }),
        )

        unwrapOrThrow(
          workSessionRepository.assignRootRun(context.tenantScope, {
            rootRunId: runId,
            sessionId,
            updatedAt: now,
          }),
        )

        unwrapOrThrow(
          sessionMessageRepository.create(context.tenantScope, {
            authorAccountId: context.tenantScope.accountId,
            content,
            createdAt: now,
            id: messageId,
            runId: runId,
            sequence: 1,
            sessionId,
            threadId,
          }),
        )

        appendWorkspaceLifecycleEvents(context, eventStore, {
          reason: 'session.bootstrap',
          resolution: workspaceResolution,
          rootRunId: runId,
          runId,
          sessionId,
          threadId,
          workspaceRef: runWorkspaceRef,
        })

        const eventInputs = [
          {
            aggregateId: sessionId,
            aggregateType: 'work_session',
            payload: {
              sessionId,
              title: createdSession.title,
            },
            type: 'session.created',
          },
          {
            aggregateId: threadId,
            aggregateType: 'session_thread',
            payload: {
              sessionId,
              threadId,
            },
            type: 'thread.created',
          },
          {
            aggregateId: messageId,
            aggregateType: 'session_message',
            payload: {
              messageId,
              sessionId,
              threadId,
            },
            type: 'message.posted',
          },
        ] as const

        for (const eventInput of eventInputs) {
          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: eventInput.aggregateId,
              aggregateType: eventInput.aggregateType,
              outboxTopics: ['projection', 'realtime'],
              payload: eventInput.payload,
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: eventInput.type,
            }),
          )
        }

        unwrapOrThrow(
          appendJobCreatedEvents({
            eventStore,
            scope: context.tenantScope,
            traceId: context.traceId,
            job: createdJob,
          }),
        )

        unwrapOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: runId,
            aggregateType: 'run',
            payload: {
              agentId: agentBinding.value.agentId,
              ...(agentBinding.value.agentName ? { agentName: agentBinding.value.agentName } : {}),
              agentRevisionId: agentBinding.value.agentRevisionId,
              rootRunId: runId,
              runId,
              sessionId,
              targetKind: agentBinding.value.targetKind,
              task: input.task ?? input.initialMessage,
              threadId,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'run.created',
          }),
        )

        if (!threadTitle) {
          appendThreadNamingRequestedEvent(context, eventStore, {
            requestId: context.services.ids.create('tnr'),
            requestedAt: now,
            sessionId,
            sourceRunId: runId,
            threadId,
            trigger: 'auto_first_message',
          })
        }

        return ok({
          messageId,
          runId,
          sessionId,
          threadId,
        })
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown bootstrap session failure'

      return err({
        message: `failed to bootstrap session: ${message}`,
        type: 'conflict',
      })
    }
  },
})
