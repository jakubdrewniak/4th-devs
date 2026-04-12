import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { buildModelsCatalog } from '../../../../application/system/models-catalog'
import {
  listObservabilityQuarantine,
  replayObservabilityQuarantineEntry,
} from '../../../../application/system/observability-quarantine'
import {
  replayObservabilityRun,
  replayObservabilitySession,
} from '../../../../application/system/observability-replay'
import { buildObservabilityStatus } from '../../../../application/system/observability-status'
import { DomainErrorException } from '../../../../shared/errors'
import { successEnvelope } from '../../api-envelope'

export const createSystemRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/health', (c) => {
    return c.json(
      successEnvelope(c, {
        status: 'ok',
      }),
    )
  })

  routes.get('/ready', (c) => {
    return c.json(
      successEnvelope(c, {
        status: 'ready',
      }),
    )
  })

  routes.get('/models', (c) => {
    const runtimeConfig = c.get('config')

    return c.json(successEnvelope(c, buildModelsCatalog(runtimeConfig, c.get('services').ai)))
  })

  routes.get('/observability', (c) => {
    const status = buildObservabilityStatus({
      config: c.get('config'),
      db: c.get('db'),
      generatedAt: c.get('services').clock.nowIso(),
      tenantScope: requireTenantScope(c),
    })

    if (!status.ok) {
      throw new DomainErrorException(status.error)
    }

    return c.json(successEnvelope(c, status.value))
  })

  routes.get('/observability/quarantine', (c) => {
    const quarantine = listObservabilityQuarantine({
      db: c.get('db'),
      tenantScope: requireTenantScope(c),
    })

    if (!quarantine.ok) {
      throw new DomainErrorException(quarantine.error)
    }

    return c.json(successEnvelope(c, quarantine.value))
  })

  routes.post('/observability/replay/run/:runId', (c) => {
    const replayed = replayObservabilityRun({
      db: c.get('db'),
      replayedAt: c.get('services').clock.nowIso(),
      runId: c.req.param('runId'),
      tenantScope: requireTenantScope(c),
    })

    if (!replayed.ok) {
      throw new DomainErrorException(replayed.error)
    }

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed.value))
  })

  routes.post('/observability/replay/session/:sessionId', (c) => {
    const replayed = replayObservabilitySession({
      db: c.get('db'),
      replayedAt: c.get('services').clock.nowIso(),
      sessionId: c.req.param('sessionId'),
      tenantScope: requireTenantScope(c),
    })

    if (!replayed.ok) {
      throw new DomainErrorException(replayed.error)
    }

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed.value))
  })

  routes.post('/observability/quarantine/:outboxId/replay', (c) => {
    const replayed = replayObservabilityQuarantineEntry({
      db: c.get('db'),
      outboxId: c.req.param('outboxId'),
      replayedAt: c.get('services').clock.nowIso(),
      tenantScope: requireTenantScope(c),
    })

    if (!replayed.ok) {
      throw new DomainErrorException(replayed.error)
    }

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed.value))
  })

  return routes
}
