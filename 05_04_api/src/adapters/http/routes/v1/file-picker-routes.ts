import { Hono } from 'hono'
import { z } from 'zod'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { searchFilePicker } from '../../../../application/files/file-picker-search'
import { DomainErrorException } from '../../../../shared/errors'
import { asWorkSessionId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  query: z.string().optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
})

export const createFilePickerRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/search', async (c) => {
    const parsed = querySchema.safeParse({
      limit: c.req.query('limit'),
      query: c.req.query('query') ?? '',
      sessionId: c.req.query('sessionId') ?? undefined,
    })

    if (!parsed.success) {
      throw new DomainErrorException({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const result = await searchFilePicker(
      c.get('db'),
      {
        limit: parsed.data.limit,
        query: parsed.data.query,
        sessionId: parsed.data.sessionId ? asWorkSessionId(parsed.data.sessionId) : null,
      },
      {
        createId: c.get('services').ids.create,
        fileStorageRoot: c.get('config').files.storage.root,
        tenantScope: requireTenantScope(c),
      },
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  return routes
}
