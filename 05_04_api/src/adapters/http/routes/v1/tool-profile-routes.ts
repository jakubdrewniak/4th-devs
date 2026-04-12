import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  createToolProfileService,
  parseCreateToolProfileInput,
  parseUpdateToolProfileInput,
} from '../../../../application/tool-access/tool-profile-service'
import { DomainErrorException } from '../../../../shared/errors'
import { asToolProfileId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'

const toToolProfileService = (c: Parameters<typeof requireTenantScope>[0]) =>
  createToolProfileService({
    createId: c.get('services').ids.create,
    db: c.get('db'),
    now: () => c.get('services').clock.nowIso(),
  })

export const createToolProfileRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', (c) => {
    const result = toToolProfileService(c).listToolProfiles(requireTenantScope(c))

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.post('/', async (c) => {
    const parsedInput = parseCreateToolProfileInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const result = toToolProfileService(c).createToolProfile(
      requireTenantScope(c),
      parsedInput.value,
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 201)
  })

  routes.get('/:toolProfileId', (c) => {
    const result = toToolProfileService(c).getToolProfileById(
      requireTenantScope(c),
      asToolProfileId(c.req.param('toolProfileId')),
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.patch('/:toolProfileId', async (c) => {
    const parsedInput = parseUpdateToolProfileInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const result = toToolProfileService(c).updateToolProfile(
      requireTenantScope(c),
      asToolProfileId(c.req.param('toolProfileId')),
      parsedInput.value,
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  return routes
}
