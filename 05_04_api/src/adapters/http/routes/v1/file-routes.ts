import { Hono } from 'hono'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createResourceAccessService } from '../../../../application/access/resource-access'
import { createFileRepository, type FileRecord } from '../../../../domain/files/file-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asFileId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'

const toFileSummary = (apiBasePath: string, file: FileRecord) => ({
  accessScope: file.accessScope,
  contentUrl: `${apiBasePath}/files/${file.id}/content`,
  createdAt: file.createdAt,
  id: file.id,
  mimeType: file.mimeType,
  originalFilename: file.originalFilename,
  sizeBytes: file.sizeBytes,
  sourceKind: file.sourceKind,
  status: file.status,
  title: file.title,
})

const toDispositionFilename = (value: string | null): string =>
  (value ?? 'file').replace(/[\r\n"]/g, '_').replace(/[\\/]/g, '_')

export const createFileRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', async (c) => {
    const tenantScope = requireTenantScope(c)
    const requestedScope = c.req.query('scope')

    if (requestedScope !== 'account_library') {
      throw new DomainErrorException({
        message: 'Only scope=account_library is currently supported on this endpoint',
        type: 'validation',
      })
    }

    const result = createFileRepository(c.get('db')).listAccountLibraryByAccountId(tenantScope)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(
        c,
        result.value.map((file) => toFileSummary(c.get('config').api.basePath, file)),
      ),
      200,
    )
  })

  routes.get('/:fileId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const result = createResourceAccessService(c.get('db')).requireFileAccess(
      tenantScope,
      asFileId(c.req.param('fileId')),
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(c, toFileSummary(c.get('config').api.basePath, result.value)),
      200,
    )
  })

  routes.get('/:fileId/content', async (c) => {
    const tenantScope = requireTenantScope(c)
    const fileResult = createResourceAccessService(c.get('db')).requireFileAccess(
      tenantScope,
      asFileId(c.req.param('fileId')),
    )

    if (!fileResult.ok) {
      throw new DomainErrorException(fileResult.error)
    }

    if (fileResult.value.status !== 'ready') {
      throw new DomainErrorException({
        message: `file ${fileResult.value.id} is not ready`,
        type: 'conflict',
      })
    }

    const blobResult = await c.get('services').files.blobStore.get(fileResult.value.storageKey)

    if (!blobResult.ok) {
      throw new DomainErrorException(blobResult.error)
    }

    const headers = new Headers()
    headers.set('content-type', fileResult.value.mimeType ?? 'application/octet-stream')
    headers.set(
      'content-disposition',
      `inline; filename="${toDispositionFilename(fileResult.value.originalFilename)}"`,
    )

    return new Response(Buffer.from(blobResult.value.body), {
      headers,
      status: 200,
    })
  })

  return routes
}
