import { Hono } from 'hono'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createResourceAccessService } from '../../../../application/access/resource-access'
import {
  createCancelRunCommand,
  parseCancelRunInput,
} from '../../../../application/commands/cancel-run'
import {
  createExecuteRunCommand,
  parseExecuteRunInput,
} from '../../../../application/commands/execute-run'
import {
  createResumeRunCommand,
  parseResumeRunInput,
} from '../../../../application/commands/resume-run'
import { loadRunJobReadModel } from '../../../../application/runtime/job-read-model'
import {
  recoverCancelRunOutput,
  recoverExecuteRunOutput,
  recoverResumeRunOutput,
} from '../../../../application/runtime/run-command-recovery'
import { DomainErrorException } from '../../../../shared/errors'
import { asRunId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { maybeHandleIdempotentJsonRoute } from '../../idempotency'
import { cancelRunOutputSchema, runExecutionOutputSchema } from '../../idempotency-response-schemas'
import { parseJsonBody } from '../../parse-json-body'

const toCommandContext = (c: Parameters<typeof requireTenantScope>[0]) => ({
  config: c.get('config'),
  db: c.get('db'),
  requestId: c.get('requestId'),
  services: c.get('services'),
  tenantScope: requireTenantScope(c),
  traceId: c.get('traceId'),
})

export const createRunRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const cancelRunCommand = createCancelRunCommand()
  const executeRunCommand = createExecuteRunCommand()
  const resumeRunCommand = createResumeRunCommand()
  const toCancelHttpStatus = (status: 'cancelled' | 'cancelling'): 200 | 202 =>
    status === 'cancelling' ? 202 : 200

  routes.get('/:runId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const resourceAccess = createResourceAccessService(c.get('db'))
    const result = resourceAccess.requireRunAccess(tenantScope, asRunId(c.req.param('runId')))

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    const job = loadRunJobReadModel(c.get('db'), tenantScope, result.value.run)

    if (!job.ok) {
      throw new DomainErrorException(job.error)
    }

    return c.json(
      successEnvelope(c, {
        ...result.value.run,
        job: job.value,
      }),
      200,
    )
  })

  routes.post('/:runId/execute', async (c) => {
    const parsedInput = parseExecuteRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        const result = await executeRunCommand.execute(commandContext, runId, parsedInput.value)

        if (!result.ok) {
          if (result.error.type === 'conflict') {
            const recovered = await recoverExecuteRunOutput({
              command: executeRunCommand,
              context: commandContext,
              executeInput: parsedInput.value,
              runId,
            })

            if (!recovered.ok) {
              throw new DomainErrorException(recovered.error)
            }

            if (recovered.value) {
              return {
                data: recovered.value,
                status: recovered.value.status === 'waiting' ? 202 : 200,
              }
            }
          }

          throw new DomainErrorException(result.error)
        }

        return {
          data: result.value,
          status: result.value.status === 'waiting' ? 202 : 200,
        }
      },
      parseReplayData: (value) => runExecutionOutputSchema.parse(value),
      recoverInProgress: async () => {
        const recovered = await recoverExecuteRunOutput({
          command: executeRunCommand,
          context: toCommandContext(c),
          executeInput: parsedInput.value,
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return {
          data: recovered.value,
          status: recovered.value.status === 'waiting' ? 202 : 200,
        }
      },
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/runs/${runId}/execute`,
    })
  })

  routes.post('/:runId/resume', async (c) => {
    const parsedInput = parseResumeRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        const result = await resumeRunCommand.execute(commandContext, runId, parsedInput.value)

        if (!result.ok) {
          if (result.error.type === 'conflict') {
            const recovered = await recoverResumeRunOutput({
              command: resumeRunCommand,
              context: commandContext,
              resumeInput: parsedInput.value,
              runId,
            })

            if (!recovered.ok) {
              throw new DomainErrorException(recovered.error)
            }

            if (recovered.value) {
              return {
                data: recovered.value,
                status: recovered.value.status === 'waiting' ? 202 : 200,
              }
            }
          }

          throw new DomainErrorException(result.error)
        }

        return {
          data: result.value,
          status: result.value.status === 'waiting' ? 202 : 200,
        }
      },
      parseReplayData: (value) => runExecutionOutputSchema.parse(value),
      recoverInProgress: async () => {
        const recovered = await recoverResumeRunOutput({
          command: resumeRunCommand,
          context: toCommandContext(c),
          resumeInput: parsedInput.value,
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return {
          data: recovered.value,
          status: recovered.value.status === 'waiting' ? 202 : 200,
        }
      },
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/runs/${runId}/resume`,
    })
  })

  routes.post('/:runId/cancel', async (c) => {
    const parsedInput = parseCancelRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        const result = cancelRunCommand.execute(commandContext, runId, parsedInput.value)

        if (!result.ok) {
          if (result.error.type === 'conflict') {
            const recovered = await recoverCancelRunOutput({
              cancelInput: parsedInput.value,
              command: cancelRunCommand,
              context: commandContext,
              runId,
            })

            if (!recovered.ok) {
              throw new DomainErrorException(recovered.error)
            }

            if (recovered.value) {
              return {
                data: recovered.value,
                status: toCancelHttpStatus(recovered.value.status),
              }
            }
          }

          throw new DomainErrorException(result.error)
        }

        return {
          data: result.value,
          status: toCancelHttpStatus(result.value.status),
        }
      },
      parseReplayData: (value) => cancelRunOutputSchema.parse(value),
      recoverInProgress: async () => {
        const recovered = await recoverCancelRunOutput({
          cancelInput: parsedInput.value,
          command: cancelRunCommand,
          context: toCommandContext(c),
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return {
          data: recovered.value,
          status: toCancelHttpStatus(recovered.value.status),
        }
      },
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      scope: `POST ${c.get('config').api.basePath}/runs/${runId}/cancel`,
    })
  })

  return routes
}
