import { Hono } from 'hono'
import { z } from 'zod'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createResourceAccessService } from '../../../../application/access/resource-access'
import {
  type BootstrapSessionInput,
  type BootstrapSessionOutput,
  createBootstrapSessionCommand,
  parseBootstrapSessionInput,
} from '../../../../application/commands/bootstrap-session'
import {
  createCreateSessionCommand,
  parseCreateSessionInput,
} from '../../../../application/commands/create-session'
import {
  createCreateSessionThreadCommand,
  parseCreateSessionThreadInput,
} from '../../../../application/commands/create-session-thread'
import { createExecuteRunCommand } from '../../../../application/commands/execute-run'
import { recoverExecuteRunOutput } from '../../../../application/runtime/run-command-recovery'
import type { RunExecutionOutput } from '../../../../application/runtime/run-persistence'
import { createFileRepository } from '../../../../domain/files/file-repository'
import type { HttpIdempotencyKeyRecord } from '../../../../domain/operations/http-idempotency-key-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asRunId, asWorkSessionId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import {
  maybeHandleIdempotentJsonRoute,
  recoverRecordedIdempotentProgress,
} from '../../idempotency'
import {
  bootstrapSessionOutputSchema,
  bootstrapSessionRouteOutputSchema,
  sessionThreadRecordSchema,
  workSessionRecordSchema,
} from '../../idempotency-response-schemas'
import { parseJsonBody } from '../../parse-json-body'

const bootstrapSessionRecoverySnapshotSchema = z.object({
  inputMessageId: z.string().trim().min(1).max(200),
  kind: z.literal('bootstrap_session_started'),
  runId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(200),
})

const buildBootstrapSessionRecoverySnapshot = (output: BootstrapSessionOutput) => ({
  inputMessageId: output.messageId,
  kind: 'bootstrap_session_started' as const,
  runId: output.runId,
  sessionId: output.sessionId,
  threadId: output.threadId,
})

const toBootstrapSessionSuccess = (
  snapshot: z.infer<typeof bootstrapSessionRecoverySnapshotSchema>,
  output: RunExecutionOutput,
) =>
  ({
    data: {
      ...output,
      inputMessageId: snapshot.inputMessageId,
      sessionId: snapshot.sessionId,
      threadId: snapshot.threadId,
    },
    status: output.status === 'waiting' ? 202 : 201,
  }) as const

const toCommandContext = (c: Parameters<typeof requireTenantScope>[0]) => ({
  config: c.get('config'),
  db: c.get('db'),
  requestId: c.get('requestId'),
  services: c.get('services'),
  tenantScope: requireTenantScope(c),
  traceId: c.get('traceId'),
})

const toBootstrapExecuteOverrides = (input: BootstrapSessionInput) => ({
  maxOutputTokens: input.maxOutputTokens,
  model: input.model,
  modelAlias: input.modelAlias,
  provider: input.provider,
  reasoning: input.reasoning,
  temperature: input.temperature,
})

export const createSessionRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const bootstrapSessionCommand = createBootstrapSessionCommand()
  const createSessionCommand = createCreateSessionCommand()
  const createSessionThreadCommand = createCreateSessionThreadCommand()
  const executeRunCommand = createExecuteRunCommand()

  routes.post('/', async (c) => {
    const parsedInput = parseCreateSessionInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async (idempotency) => {
        const result = createSessionCommand.execute(toCommandContext(c), parsedInput.value)

        if (!result.ok) {
          throw new DomainErrorException(result.error)
        }

        idempotency?.recordProgress(result.value)

        return {
          data: result.value,
          status: 201,
        }
      },
      parseReplayData: (value) => workSessionRecordSchema.parse(value),
      recoverInProgress: ({ record }) =>
        recoverRecordedIdempotentProgress({
          parse: (value) => workSessionRecordSchema.parse(value),
          record,
          status: 201,
        }),
      requestBody: parsedInput.value,
      scope: `POST ${c.get('config').api.basePath}/sessions`,
    })
  })

  routes.post('/:sessionId/threads', async (c) => {
    const parsedInput = parseCreateSessionThreadInput(await parseJsonBody(c))
    const sessionId = asWorkSessionId(c.req.param('sessionId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async (idempotency) => {
        const result = createSessionThreadCommand.execute(
          toCommandContext(c),
          sessionId,
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
      parseReplayData: (value) => sessionThreadRecordSchema.parse(value),
      recoverInProgress: ({ record }) =>
        recoverRecordedIdempotentProgress({
          parse: (value) => sessionThreadRecordSchema.parse(value),
          record,
          status: 201,
        }),
      requestBody: {
        sessionId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/sessions/${sessionId}/threads`,
    })
  })

  routes.get('/:sessionId/files', async (c) => {
    const tenantScope = requireTenantScope(c)
    const sessionId = asWorkSessionId(c.req.param('sessionId'))
    const resourceAccess = createResourceAccessService(c.get('db'))
    const session = resourceAccess.requireSessionAccess(tenantScope, sessionId)

    if (!session.ok) {
      throw new DomainErrorException(session.error)
    }

    const result = createFileRepository(c.get('db')).listBySessionId(tenantScope, sessionId)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(
        c,
        result.value.map((file) => ({
          accessScope: file.accessScope,
          contentUrl: `${c.get('config').api.basePath}/files/${file.id}/content`,
          createdAt: file.createdAt,
          id: file.id,
          mimeType: file.mimeType,
          originalFilename: file.originalFilename,
          sizeBytes: file.sizeBytes,
          sourceKind: file.sourceKind,
          status: file.status,
          title: file.title,
        })),
      ),
      200,
    )
  })

  // The current frontend does not use this route. Keep it as a convenience
  // endpoint for callers that want to start the first turn in a single request.
  routes.post('/bootstrap', async (c) => {
    const parsedInput = parseBootstrapSessionInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute<z.infer<typeof bootstrapSessionRouteOutputSchema>>(c, {
      execute: async (idempotency) => {
        const commandContext = toCommandContext(c)
        const result = bootstrapSessionCommand.execute(commandContext, parsedInput.value)

        if (!result.ok) {
          throw new DomainErrorException(result.error)
        }

        if (parsedInput.value.execute !== true) {
          idempotency?.recordProgress(result.value)

          return {
            data: result.value,
            status: 201,
          }
        }

        const snapshot = buildBootstrapSessionRecoverySnapshot(result.value)
        const executeOverrides = toBootstrapExecuteOverrides(parsedInput.value)

        idempotency?.recordProgress(snapshot)

        const executeResult = await executeRunCommand.execute(
          commandContext,
          asRunId(result.value.runId),
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
              return toBootstrapSessionSuccess(snapshot, recovered.value)
            }
          }

          throw new DomainErrorException(executeResult.error)
        }

        return toBootstrapSessionSuccess(snapshot, executeResult.value)
      },
      parseReplayData: (value) => bootstrapSessionRouteOutputSchema.parse(value),
      recoverInProgress: async ({ record }: { record: HttpIdempotencyKeyRecord }) => {
        if (parsedInput.value.execute !== true) {
          return recoverRecordedIdempotentProgress({
            parse: (value) => bootstrapSessionOutputSchema.parse(value),
            record,
            status: 201,
          })
        }

        const snapshot = bootstrapSessionRecoverySnapshotSchema.safeParse(record.responseDataJson)

        if (!snapshot.success) {
          return null
        }

        const recovered = await recoverExecuteRunOutput({
          command: executeRunCommand,
          context: toCommandContext(c),
          executeInput: toBootstrapExecuteOverrides(parsedInput.value),
          runId: asRunId(snapshot.data.runId),
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return toBootstrapSessionSuccess(snapshot.data, recovered.value)
      },
      requestBody: parsedInput.value,
      scope: `POST ${c.get('config').api.basePath}/sessions/bootstrap`,
    })
  })

  return routes
}
