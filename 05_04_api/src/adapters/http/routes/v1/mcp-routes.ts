import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import {
  canStartAuthorizationCodeOAuth,
  isAuthorizationCodeServer,
  type McpAuthorizationCodeServerConfig,
  toAuthorizationCodeServerConfig,
} from '../../../../adapters/mcp/oauth-authorization-code'
import {
  beginStoredMcpAuthorization,
  completeStoredMcpAuthorization,
} from '../../../../adapters/mcp/oauth-provider'
import { protectStoredHttpAuthConfig } from '../../../../adapters/mcp/stored-auth'
import type { McpDiscoveredTool, McpServerConfig } from '../../../../adapters/mcp/types'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createMcpOauthAuthorizationRepository } from '../../../../domain/mcp/mcp-oauth-authorization-repository'
import { createMcpOauthCredentialRepository } from '../../../../domain/mcp/mcp-oauth-credential-repository'
import {
  createMcpServerRepository,
  type McpServerRecord,
  toMcpServerConfig,
} from '../../../../domain/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../../../domain/mcp/mcp-tool-assignment-repository'
import { createMcpToolCacheRepository } from '../../../../domain/mcp/mcp-tool-cache-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asToolProfileId } from '../../../../shared/ids'
import { ok } from '../../../../shared/result'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'

const logLevelSchema = z.enum([
  'alert',
  'critical',
  'debug',
  'emergency',
  'error',
  'info',
  'notice',
  'warning',
])

const recordSchema = z.record(z.string(), z.string())

const mcpStoredHttpAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('bearer'),
    token: z.string().trim().min(1),
  }),
  z.object({
    clientId: z.string().trim().min(1).optional(),
    clientName: z.string().trim().min(1).optional(),
    clientSecret: z.string().trim().min(1).optional(),
    kind: z.literal('oauth_authorization_code'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
    tokenEndpointAuthMethod: z.string().trim().min(1).optional(),
  }),
  z.object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
    kind: z.literal('oauth_client_credentials'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    algorithm: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_private_key_jwt'),
    privateKey: z.string().trim().min(1),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    assertion: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_static_private_key_jwt'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
])

const createMcpServerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    config: z.object({
      args: z.array(z.string()).optional(),
      command: z.string().trim().min(1),
      cwd: z.string().trim().min(1).optional(),
      env: recordSchema.optional(),
      stderr: z.enum(['inherit', 'pipe']).optional(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('stdio'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
  z.object({
    config: z.object({
      auth: mcpStoredHttpAuthSchema.optional(),
      headers: recordSchema.optional(),
      url: z.string().url(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('streamable_http'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
])

const assignMcpToolInputSchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
    requiresConfirmation: z.boolean().optional(),
    runtimeName: z.string().trim().min(1).max(300),
    serverId: z.string().trim().min(1).max(200),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

const deleteMcpToolAssignmentQuerySchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

const resolveRequestedToolProfileId = (input: {
  toolProfileId?: string | null | undefined
}): string | null => input.toolProfileId?.trim() || null

const beginMcpAuthorizationInputSchema = z.object({
  responseOrigin: z.string().url().optional(),
})

const mcpAppOriginQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).optional(),
    format: z.enum(['html', 'raw']).optional(),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
    uri: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required query parameters: serverId (or toolName)',
    path: ['serverId'],
  })

const mcpAppToolCallInputSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()).nullish(),
    name: z.string().trim().min(1),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required body fields: serverId (or toolName)',
    path: ['serverId'],
  })

const mcpOauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1),
})

const toStoredServerConfig = (
  input: z.infer<typeof createMcpServerInputSchema>,
  encryptionKey: string | null,
) =>
  input.kind === 'stdio'
    ? {
        args: input.config.args,
        command: input.config.command,
        cwd: input.config.cwd,
        env: input.config.env,
        stderr: input.config.stderr,
      }
    : {
        auth:
          input.config.auth?.kind === 'none' || !input.config.auth
            ? { kind: 'none' as const }
            : protectStoredHttpAuthConfig(
                input.config.auth.kind === 'bearer'
                  ? {
                      kind: 'bearer' as const,
                      token: input.config.auth.token,
                    }
                  : input.config.auth.kind === 'oauth_authorization_code'
                    ? {
                        clientId: input.config.auth.clientId ?? null,
                        clientName: input.config.auth.clientName ?? null,
                        clientSecret: input.config.auth.clientSecret ?? null,
                        kind: 'oauth_authorization_code' as const,
                        resource: input.config.auth.resource ?? null,
                        resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                        scope: input.config.auth.scope ?? null,
                        tokenEndpointAuthMethod: input.config.auth.tokenEndpointAuthMethod ?? null,
                      }
                    : input.config.auth.kind === 'oauth_client_credentials'
                      ? {
                          clientId: input.config.auth.clientId,
                          clientSecret: input.config.auth.clientSecret,
                          kind: 'oauth_client_credentials' as const,
                          resource: input.config.auth.resource ?? null,
                          resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                          scope: input.config.auth.scope ?? null,
                        }
                      : input.config.auth.kind === 'oauth_private_key_jwt'
                        ? {
                            algorithm: input.config.auth.algorithm,
                            clientId: input.config.auth.clientId,
                            kind: 'oauth_private_key_jwt' as const,
                            privateKey: input.config.auth.privateKey,
                            resource: input.config.auth.resource ?? null,
                            resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                            scope: input.config.auth.scope ?? null,
                          }
                        : {
                            assertion: input.config.auth.assertion,
                            clientId: input.config.auth.clientId,
                            kind: 'oauth_static_private_key_jwt' as const,
                            resource: input.config.auth.resource ?? null,
                            resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                            scope: input.config.auth.scope ?? null,
                          },
                encryptionKey,
              ),
        headers: input.config.headers,
        url: input.config.url,
      }

const parseBody = async <TValue>(
  c: Context<AppEnv>,
  schema: z.ZodType<TValue>,
): Promise<TValue> => {
  const parsed = schema.safeParse(await parseJsonBody(c))

  if (!parsed.success) {
    throw new DomainErrorException({
      message: parsed.error.issues.map((issue: z.ZodIssue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return parsed.data
}

const isStaticServerVisibleToTenant = (server: McpServerConfig, tenantId: string): boolean =>
  !server.allowedTenantIds || server.allowedTenantIds.length === 0
    ? true
    : server.allowedTenantIds.includes(tenantId)

const toApiStaticServerConfig = (server: McpServerConfig): Record<string, unknown> =>
  server.kind === 'stdio'
    ? {
        args: server.args,
        command: server.command,
        cwd: server.cwd,
        env: server.env,
        stderr: server.stderr,
      }
    : {
        auth: server.auth,
        headers: server.headers,
        url: server.url,
      }

const toApiDbServer = (server: McpServerRecord, encryptionKey: string | null) => ({
  ...server,
  config: toApiStaticServerConfig(toMcpServerConfig(server, encryptionKey)),
  source: 'db' as const,
})

const toApiStaticServer = (server: McpServerConfig, tenantId: string) => ({
  config: toApiStaticServerConfig(server),
  createdAt: null,
  createdByAccountId: null,
  enabled: server.enabled,
  id: server.id,
  kind: server.kind,
  label: server.toolPrefix ?? server.id,
  lastDiscoveredAt: null,
  lastError: null,
  logLevel: server.logLevel ?? null,
  source: 'static' as const,
  tenantId,
  updatedAt: null,
})

const toApiStaticTool = (tenantId: string, tool: McpDiscoveredTool) => ({
  appsMetaJson: tool.apps,
  assignment: null,
  createdAt: null,
  description: tool.description ?? null,
  executionJson:
    tool.execution && typeof tool.execution === 'object'
      ? (JSON.parse(JSON.stringify(tool.execution)) as Record<string, unknown>)
      : null,
  fingerprint: tool.fingerprint,
  id: `mct_static_${tool.serverId}_${tool.runtimeName}`,
  inputSchemaJson: tool.inputSchema,
  isActive: true,
  modelVisible: tool.modelVisible,
  outputSchemaJson: tool.outputSchema,
  remoteName: tool.remoteName,
  runtimeName: tool.runtimeName,
  serverId: tool.serverId,
  tenantId,
  title: tool.title,
  updatedAt: null,
})

const buildMcpOauthCallbackUrl = (c: Context<AppEnv>): string =>
  new URL(`${c.get('config').api.basePath}/mcp/oauth/callback`, c.req.url).toString()

const resolveMcpServerId = (
  c: Context<AppEnv>,
  serverId: string | null | undefined,
  toolName: string | null | undefined,
): string => {
  if (serverId) {
    return serverId
  }

  if (!toolName) {
    throw new DomainErrorException({
      message: 'Missing required query parameters: serverId (or toolName)',
      type: 'validation',
    })
  }

  const tool = c.get('services').mcp.getTool(toolName)

  if (!tool) {
    throw new DomainErrorException({
      message: `MCP tool ${toolName} was not found`,
      type: 'not_found',
    })
  }

  return tool.serverId
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderOauthCompletionPage = (input: {
  message: string
  responseOrigin: string | null
  serverId: string | null
  status: 'authorized' | 'error'
}) => {
  const payload = JSON.stringify({
    message: input.message,
    serverId: input.serverId,
    status: input.status,
    type: '05_04_api.mcp_oauth',
  }).replace(/</g, '\\u003c')
  const targetOrigin = JSON.stringify(input.responseOrigin ?? '*')

  const isSuccess = input.status === 'authorized'
  const statusLabel = isSuccess ? 'Authorization complete' : 'Authorization failed'
  const statusColor = isSuccess ? '#4ade80' : '#f87171'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${statusLabel}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html{background:#09090b;color:#ececef;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
      body{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
      .logo{width:80px;height:72px;margin-bottom:2rem;opacity:0.18}
      .status{font-size:15px;font-weight:600;color:${statusColor};margin-bottom:0.5rem}
      .message{font-size:13px;color:#a0a0ab;line-height:1.6;text-align:center;max-width:28rem}
      .hint{margin-top:1.5rem;font-size:11px;color:#63636e}
    </style>
  </head>
  <body>
    <svg class="logo" viewBox="0 0 25.03 22" fill="currentColor" aria-hidden="true">
      <path d="M12.697 22V16.882H6.417a5.15 5.15 0 0 1-5.151-5.15V10.502c0-2.671 1.777-4.936 4.21-5.674L3.862.932 6.113 0l2.904 7.01H6.416a2.715 2.715 0 0 0-2.715 2.715v2.005a2.715 2.715 0 0 0 2.715 2.715h8.717v2.743c1.767-1.297 4.174-3.063 4.655-3.417a3.94 3.94 0 0 0 1.43-2.818V9.724a2.715 2.715 0 0 0-2.715-2.714h-7.769L9.666 4.573h8.836a5.15 5.15 0 0 1 5.151 5.151v1.228a5.24 5.24 0 0 1-2.425 4.783s-6.593 4.839-6.593 4.839L12.697 22Z"/>
      <path d="M18.927.0004 16.461 5.953l2.251.933 2.466-5.953L18.927.0004Z"/>
      <path d="M2.934 9.42H0v2.707h2.934V9.42Z"/>
      <path d="M25.028 9.42h-2.934v2.707h2.934V9.42Z"/>
    </svg>
    <div class="status">${escapeHtml(statusLabel)}</div>
    <p class="message">${escapeHtml(input.message)}</p>
    <p class="hint">This window will close automatically.</p>
    <script>
      const payload = ${payload};
      const targetOrigin = ${targetOrigin};
      const notifyOpener = function() {
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(payload, targetOrigin);
            return true;
          } catch {}
        }

        return false;
      };

      if (notifyOpener()) {
        setTimeout(notifyOpener, 250);
        setTimeout(notifyOpener, 700);
        setTimeout(function() { window.close(); }, 1200);
      }
    </script>
  </body>
</html>`
}

const resolveAuthorizationCodeServer = (
  c: Context<AppEnv>,
  tenantScope: ReturnType<typeof requireTenantScope>,
  serverId: string,
): McpAuthorizationCodeServerConfig => {
  const repository = createMcpServerRepository(c.get('db'))
  const storedServer = repository.getById(tenantScope, serverId)

  if (storedServer.ok) {
    const config = toMcpServerConfig(storedServer.value, c.get('config').mcp.secretEncryptionKey)

    if (!canStartAuthorizationCodeOAuth(config)) {
      throw new DomainErrorException({
        message: `MCP server ${serverId} does not support browser OAuth authorization`,
        type: 'conflict',
      })
    }

    return toAuthorizationCodeServerConfig(config)
  }

  const staticServer = c
    .get('config')
    .mcp.servers.find(
      (entry) =>
        entry.id === serverId && isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
    )

  if (!staticServer) {
    throw new DomainErrorException(storedServer.error)
  }

  if (!canStartAuthorizationCodeOAuth(staticServer)) {
    throw new DomainErrorException({
      message: `MCP server ${serverId} does not support browser OAuth authorization`,
      type: 'conflict',
    })
  }

  return toAuthorizationCodeServerConfig(staticServer)
}

export const createMcpRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/servers', (c) => {
    const tenantScope = requireTenantScope(c)
    const repository = createMcpServerRepository(c.get('db'))
    const result = repository.listByAccount(tenantScope)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    const staticServers = c
      .get('config')
      .mcp.servers.filter((server) => isStaticServerVisibleToTenant(server, tenantScope.tenantId))
      .map((server) => toApiStaticServer(server, tenantScope.tenantId))
    const entries = [
      ...staticServers,
      ...result.value.map((server) =>
        toApiDbServer(server, c.get('config').mcp.secretEncryptionKey),
      ),
    ].sort((left, right) => {
      const labelOrder = left.label.localeCompare(right.label)
      return labelOrder !== 0 ? labelOrder : left.id.localeCompare(right.id)
    })

    return c.json(
      successEnvelope(
        c,
        entries.map((server) => ({
          ...server,
          snapshot: c.get('services').mcp.getServerSnapshot(tenantScope, server.id),
        })),
      ),
      200,
    )
  })

  routes.post('/servers', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseBody(c, createMcpServerInputSchema)
    const now = c.get('services').clock.nowIso()
    const repository = createMcpServerRepository(c.get('db'))
    const created = repository.create(tenantScope, {
      config: toStoredServerConfig(input, c.get('config').mcp.secretEncryptionKey),
      createdAt: now,
      enabled: input.enabled,
      id: c.get('services').ids.create('mcs'),
      kind: input.kind,
      label: input.label,
      logLevel: input.logLevel ?? null,
      updatedAt: now,
    })

    if (!created.ok) {
      throw new DomainErrorException(created.error)
    }

    const refreshed = await c.get('services').mcp.refreshServer(tenantScope, created.value.id)

    if (!refreshed.ok) {
      throw new DomainErrorException(refreshed.error)
    }

    return c.json(
      successEnvelope(c, {
        server: toApiDbServer(created.value, c.get('config').mcp.secretEncryptionKey),
        snapshot: refreshed.value,
      }),
      201,
    )
  })

  routes.patch('/servers/:serverId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const input = await parseBody(c, createMcpServerInputSchema)
    const now = c.get('services').clock.nowIso()
    const repository = createMcpServerRepository(c.get('db'))
    const updated = repository.update(tenantScope, {
      config: toStoredServerConfig(input, c.get('config').mcp.secretEncryptionKey),
      enabled: input.enabled,
      id: serverId,
      kind: input.kind,
      label: input.label,
      logLevel: input.logLevel ?? null,
      updatedAt: now,
    })

    if (!updated.ok) {
      throw new DomainErrorException(updated.error)
    }

    const refreshed = await c.get('services').mcp.refreshServer(tenantScope, updated.value.id)

    if (!refreshed.ok) {
      throw new DomainErrorException(refreshed.error)
    }

    return c.json(
      successEnvelope(c, {
        server: toApiDbServer(updated.value, c.get('config').mcp.secretEncryptionKey),
        snapshot: refreshed.value,
      }),
      200,
    )
  })

  routes.delete('/servers/:serverId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const oauthAuthorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
    const oauthCredentialRepository = createMcpOauthCredentialRepository(c.get('db'))
    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolAssignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const toolCacheRepository = createMcpToolCacheRepository(c.get('db'))

    const deletedAssignments = toolAssignmentRepository.deleteByServerId(tenantScope, serverId)

    if (!deletedAssignments.ok) {
      throw new DomainErrorException(deletedAssignments.error)
    }

    const deletedCache = toolCacheRepository.deleteByServerId(tenantScope, serverId)

    if (!deletedCache.ok) {
      throw new DomainErrorException(deletedCache.error)
    }

    const deletedCredentials = oauthCredentialRepository.deleteByServerId(tenantScope, serverId)

    if (!deletedCredentials.ok) {
      throw new DomainErrorException(deletedCredentials.error)
    }

    const pendingAuthorization = oauthAuthorizationRepository.getByServerId(tenantScope, serverId)

    if (pendingAuthorization.ok) {
      const deletedAuthorization = oauthAuthorizationRepository.deleteById(
        pendingAuthorization.value.id,
      )

      if (!deletedAuthorization.ok) {
        throw new DomainErrorException(deletedAuthorization.error)
      }
    }

    const deletedServer = serverRepository.delete(tenantScope, serverId)

    if (!deletedServer.ok) {
      throw new DomainErrorException(deletedServer.error)
    }

    const removed = await c.get('services').mcp.removeRegisteredServer(tenantScope, serverId)

    if (!removed.ok) {
      throw new DomainErrorException(removed.error)
    }

    return c.json(
      successEnvelope(c, {
        deletedToolAssignments: deletedAssignments.value,
        deletedTools: deletedCache.value,
        serverId: deletedServer.value.id,
      }),
      200,
    )
  })

  routes.post('/servers/:serverId/refresh', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const refreshed = await c.get('services').mcp.refreshServer(tenantScope, serverId)

    if (!refreshed.ok) {
      throw new DomainErrorException(refreshed.error)
    }

    return c.json(successEnvelope(c, refreshed.value), 200)
  })

  routes.post('/servers/:serverId/oauth/start', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const input = await parseBody(c, beginMcpAuthorizationInputSchema)
    const server = resolveAuthorizationCodeServer(c, tenantScope, serverId)
    const nowIso = c.get('services').clock.nowIso()
    const authorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
    const deletedExpired = authorizationRepository.deleteExpired(nowIso)

    if (!deletedExpired.ok) {
      throw new DomainErrorException(deletedExpired.error)
    }

    const started = await beginStoredMcpAuthorization({
      auth: server.auth,
      authorizationId: c.get('services').ids.create('moa'),
      db: c.get('db'),
      encryptionKey: c.get('config').mcp.secretEncryptionKey,
      nowIso: c.get('services').clock.nowIso,
      redirectUrl: buildMcpOauthCallbackUrl(c),
      responseOrigin: input.responseOrigin ?? null,
      scope: tenantScope,
      serverId,
      serverUrl: server.url,
    })

    if (started.kind === 'authorized') {
      const refreshed = await c.get('services').mcp.refreshServer(tenantScope, serverId)

      if (!refreshed.ok) {
        throw new DomainErrorException(refreshed.error)
      }

      return c.json(
        successEnvelope(c, {
          kind: 'authorized' as const,
          snapshot: refreshed.value,
        }),
        200,
      )
    }

    return c.json(successEnvelope(c, started), 200)
  })

  routes.get('/oauth/callback', async (c) => {
    const parsed = mcpOauthCallbackQuerySchema.safeParse({
      code: c.req.query('code'),
      error: c.req.query('error'),
      error_description: c.req.query('error_description'),
      state: c.req.query('state'),
    })

    if (!parsed.success) {
      return c.html(
        renderOauthCompletionPage({
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
          responseOrigin: null,
          serverId: null,
          status: 'error',
        }),
        400,
      )
    }

    const authorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
    const authorization = authorizationRepository.getById(parsed.data.state)

    if (!authorization.ok) {
      return c.html(
        renderOauthCompletionPage({
          message: authorization.error.message,
          responseOrigin: null,
          serverId: null,
          status: 'error',
        }),
        404,
      )
    }

    const tenantScope = {
      accountId: authorization.value.accountId,
      role: 'owner' as const,
      tenantId: authorization.value.tenantId,
    }
    const finalizeAuthorization = () => {
      const deleted = authorizationRepository.deleteById(authorization.value.id)

      if (!deleted.ok) {
        throw new DomainErrorException(deleted.error)
      }
    }

    try {
      if (authorization.value.expiresAt <= c.get('services').clock.nowIso()) {
        finalizeAuthorization()
        return c.html(
          renderOauthCompletionPage({
            message: `MCP OAuth authorization for ${authorization.value.serverId} expired. Start again.`,
            responseOrigin: authorization.value.responseOrigin,
            serverId: authorization.value.serverId,
            status: 'error',
          }),
          410,
        )
      }

      if (parsed.data.error) {
        finalizeAuthorization()
        return c.html(
          renderOauthCompletionPage({
            message:
              parsed.data.error_description ?? `OAuth authorization failed: ${parsed.data.error}`,
            responseOrigin: authorization.value.responseOrigin,
            serverId: authorization.value.serverId,
            status: 'error',
          }),
          400,
        )
      }

      if (!parsed.data.code) {
        finalizeAuthorization()
        return c.html(
          renderOauthCompletionPage({
            message: 'OAuth callback is missing its authorization code.',
            responseOrigin: authorization.value.responseOrigin,
            serverId: authorization.value.serverId,
            status: 'error',
          }),
          400,
        )
      }

      const server = resolveAuthorizationCodeServer(c, tenantScope, authorization.value.serverId)

      await completeStoredMcpAuthorization({
        auth: server.auth,
        authorizationCode: parsed.data.code,
        authorizationId: authorization.value.id,
        db: c.get('db'),
        encryptionKey: c.get('config').mcp.secretEncryptionKey,
        nowIso: c.get('services').clock.nowIso,
        redirectUrl: authorization.value.redirectUri,
        responseOrigin: authorization.value.responseOrigin,
        scope: tenantScope,
        serverId: authorization.value.serverId,
        serverUrl: server.url,
      })

      finalizeAuthorization()

      const refreshed = await c
        .get('services')
        .mcp.refreshServer(tenantScope, authorization.value.serverId)

      if (!refreshed.ok) {
        throw new DomainErrorException(refreshed.error)
      }

      return c.html(
        renderOauthCompletionPage({
          message: `MCP authorization completed for ${authorization.value.serverId}.`,
          responseOrigin: authorization.value.responseOrigin,
          serverId: authorization.value.serverId,
          status: 'authorized',
        }),
        200,
      )
    } catch (error) {
      try {
        finalizeAuthorization()
      } catch {}

      return c.html(
        renderOauthCompletionPage({
          message: error instanceof Error ? error.message : 'Unknown MCP OAuth callback failure',
          responseOrigin: authorization.value.responseOrigin,
          serverId: authorization.value.serverId,
          status: 'error',
        }),
        400,
      )
    }
  })

  routes.get('/servers/:serverId/tools', (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolRepository = createMcpToolCacheRepository(c.get('db'))
    const server = serverRepository.getById(tenantScope, serverId)

    if (!server.ok) {
      const staticServer = c
        .get('config')
        .mcp.servers.find(
          (entry) =>
            entry.id === serverId && isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
        )

      if (!staticServer) {
        throw new DomainErrorException(server.error)
      }

      const profile = resolveRequestedToolProfileId({ toolProfileId: c.req.query('toolProfileId') })
      const snapshot = c.get('services').mcp.getServerSnapshot(tenantScope, serverId)

      const assignments = profile
        ? createMcpToolAssignmentRepository(c.get('db')).listByProfile(tenantScope, profile)
        : ok([])

      if (!assignments.ok) {
        throw new DomainErrorException(assignments.error)
      }

      const assignmentByRuntimeName = new Map(
        assignments.value.map((assignment) => [assignment.runtimeName, assignment]),
      )

      const tools = c
        .get('services')
        .mcp.listTools()
        .filter((tool) => tool.serverId === serverId)
        .filter(() =>
          isAuthorizationCodeServer(staticServer) ? snapshot?.status === 'ready' : true,
        )
        .map((tool) => ({
          ...toApiStaticTool(tenantScope.tenantId, tool),
          assignment:
            getMcpRuntimeNameAliasesFromRuntimeName(tool.runtimeName)
              .map((runtimeName) => assignmentByRuntimeName.get(runtimeName) ?? null)
              .find((assignment) => assignment !== null) ?? null,
        }))

      return c.json(
        successEnvelope(c, {
          toolProfileId: profile ?? null,
          server: toApiStaticServer(staticServer, tenantScope.tenantId),
          tools,
        }),
        200,
      )
    }

    const tools = toolRepository.listByServerId(tenantScope, serverId)

    if (!tools.ok) {
      throw new DomainErrorException(tools.error)
    }

    const profile = resolveRequestedToolProfileId({ toolProfileId: c.req.query('toolProfileId') })
    const assignments = profile
      ? createMcpToolAssignmentRepository(c.get('db')).listByProfile(tenantScope, profile)
      : ok([])

    if (!assignments.ok) {
      throw new DomainErrorException(assignments.error)
    }

    const assignmentByRuntimeName = new Map(
      assignments.value.map((assignment) => [assignment.runtimeName, assignment]),
    )

    return c.json(
      successEnvelope(c, {
        toolProfileId: profile ?? null,
        server: toApiDbServer(server.value, c.get('config').mcp.secretEncryptionKey),
        tools: tools.value.map((tool) => ({
          ...tool,
          assignment:
            getMcpRuntimeNameAliasesFromRuntimeName(tool.runtimeName)
              .map((runtimeName) => assignmentByRuntimeName.get(runtimeName) ?? null)
              .find((assignment) => assignment !== null) ?? null,
        })),
      }),
      200,
    )
  })

  routes.post('/assignments', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseBody(c, assignMcpToolInputSchema)
    const toolProfileId = resolveRequestedToolProfileId(input)

    if (!toolProfileId) {
      throw new DomainErrorException({
        message: 'toolProfileId is required',
        type: 'validation',
      })
    }

    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolRepository = createMcpToolCacheRepository(c.get('db'))
    const assignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const server = serverRepository.getById(tenantScope, input.serverId)

    let resolvedRuntimeName: string | null = null

    if (server.ok) {
      const tools = toolRepository.listByServerId(tenantScope, input.serverId)

      if (!tools.ok) {
        throw new DomainErrorException(tools.error)
      }

      const tool = tools.value.find((entry) =>
        getMcpRuntimeNameAliasesFromRuntimeName(entry.runtimeName).includes(input.runtimeName),
      )

      if (tool) {
        resolvedRuntimeName = tool.runtimeName
      }
    } else {
      const staticServer = c
        .get('config')
        .mcp.servers.find(
          (entry) =>
            entry.id === input.serverId &&
            isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
        )

      if (!staticServer) {
        throw new DomainErrorException(server.error)
      }

      const staticTool = c
        .get('services')
        .mcp.listTools()
        .find(
          (tool) =>
            tool.serverId === input.serverId &&
            getMcpRuntimeNameAliasesFromRuntimeName(tool.runtimeName).includes(input.runtimeName),
        )

      if (staticTool) {
        resolvedRuntimeName = staticTool.runtimeName
      }
    }

    if (!resolvedRuntimeName) {
      throw new DomainErrorException({
        message: `MCP tool ${input.runtimeName} not found for server ${input.serverId}`,
        type: 'not_found',
      })
    }

    const assignment = assignmentRepository.upsert(tenantScope, {
      id: c.get('services').ids.create('mta'),
      requiresConfirmation: input.requiresConfirmation ?? true,
      runtimeName: resolvedRuntimeName,
      serverId: input.serverId,
      toolProfileId: asToolProfileId(toolProfileId),
      updatedAt: c.get('services').clock.nowIso(),
    })

    if (!assignment.ok) {
      throw new DomainErrorException(assignment.error)
    }

    for (const legacyRuntimeName of getMcpRuntimeNameAliasesFromRuntimeName(resolvedRuntimeName)) {
      if (legacyRuntimeName === resolvedRuntimeName) {
        continue
      }

      const deleted = assignmentRepository.deleteByRuntimeName(
        tenantScope,
        toolProfileId,
        legacyRuntimeName,
      )

      if (!deleted.ok && deleted.error.type !== 'not_found') {
        throw new DomainErrorException(deleted.error)
      }
    }

    return c.json(
      successEnvelope(c, {
        assignment: assignment.value,
      }),
      201,
    )
  })

  routes.delete('/assignments/:runtimeName', async (c) => {
    const tenantScope = requireTenantScope(c)
    const runtimeName = c.req.param('runtimeName')
    const query = deleteMcpToolAssignmentQuerySchema.safeParse({
      toolProfileId: c.req.query('toolProfileId'),
    })

    if (!query.success) {
      throw new DomainErrorException({
        message: query.error.issues.map((issue: z.ZodIssue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const assignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const toolProfileId = resolveRequestedToolProfileId(query.data)

    if (!toolProfileId) {
      throw new DomainErrorException({
        message: 'toolProfileId is required',
        type: 'validation',
      })
    }

    const deleted = assignmentRepository.deleteByAnyRuntimeName(
      tenantScope,
      toolProfileId,
      getMcpRuntimeNameAliasesFromRuntimeName(runtimeName),
    )

    if (!deleted.ok) {
      throw new DomainErrorException(deleted.error)
    }

    return c.json(
      successEnvelope(c, {
        assignment: deleted.value,
      }),
      200,
    )
  })

  routes.post('/tools/call', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseBody(c, mcpAppToolCallInputSchema)
    const serverId = resolveMcpServerId(c, input.serverId, input.toolName)
    const result = await c.get('services').mcp.callServerTool({
      args: input.arguments ?? null,
      name: input.name,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/list', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = mcpAppOriginQuerySchema.safeParse({
      cursor: c.req.query('cursor'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
    })

    if (!query.success) {
      throw new DomainErrorException({
        message: query.error.issues.map((issue: z.ZodIssue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const serverId = resolveMcpServerId(c, query.data.serverId, query.data.toolName)
    const result = await c.get('services').mcp.listResources({
      cursor: query.data.cursor,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/templates/list', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = mcpAppOriginQuerySchema.safeParse({
      cursor: c.req.query('cursor'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
    })

    if (!query.success) {
      throw new DomainErrorException({
        message: query.error.issues.map((issue: z.ZodIssue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    const serverId = resolveMcpServerId(c, query.data.serverId, query.data.toolName)
    const result = await c.get('services').mcp.listResourceTemplates({
      cursor: query.data.cursor,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/read', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = mcpAppOriginQuerySchema.safeParse({
      format: c.req.query('format'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
      uri: c.req.query('uri'),
    })

    if (!query.success) {
      throw new DomainErrorException({
        message: query.error.issues.map((issue: z.ZodIssue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    if (!query.data.uri) {
      throw new DomainErrorException({
        message: 'Missing required query parameter: uri',
        type: 'validation',
      })
    }

    const serverId = resolveMcpServerId(c, query.data.serverId, query.data.toolName)

    if (query.data.format === 'raw') {
      const rawResult = await c.get('services').mcp.readRawResource({
        serverId,
        tenantScope,
        uri: query.data.uri,
      })

      if (!rawResult.ok) {
        throw new DomainErrorException(rawResult.error)
      }

      return c.json(successEnvelope(c, rawResult.value), 200)
    }

    const result = await c.get('services').mcp.readResource({
      serverId,
      tenantScope,
      uri: query.data.uri,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(c, {
        html: result.value.html,
        mimeType: result.value.mimeType,
      }),
      200,
    )
  })

  return routes
}
