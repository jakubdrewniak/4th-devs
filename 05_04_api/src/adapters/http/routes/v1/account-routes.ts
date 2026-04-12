import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  createAccountPreferencesService,
  parseAccountPreferencesPatchInput,
} from '../../../../application/preferences/account-preferences-service'
import { DomainErrorException } from '../../../../shared/errors'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'

const toAccountPreferencesService = (c: Parameters<typeof requireTenantScope>[0]) =>
  createAccountPreferencesService({
    db: c.get('db'),
    now: () => c.get('services').clock.nowIso(),
  })

export const createAccountRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/preferences', (c) => {
    const result = toAccountPreferencesService(c).getPreferences(requireTenantScope(c))

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.patch('/preferences', async (c) => {
    const parsedInput = parseAccountPreferencesPatchInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const result = toAccountPreferencesService(c).updatePreferences(
      requireTenantScope(c),
      parsedInput.value,
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  return routes
}
