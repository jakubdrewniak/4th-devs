import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import type { McpServerConfig } from '../adapters/mcp/types'
import type { AiModelRegistry, AiProviderName } from '../domain/ai/types'
import { type AuthMethod, authMethodValues } from '../shared/auth'

const nodeEnvSchema = z.enum(['development', 'test', 'production'])
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
const authModeSchema = z.enum(['api_key', 'disabled'])
const authMethodSchema = z.enum(authMethodValues)
const authSessionSameSiteSchema = z.enum(['lax', 'strict', 'none'])
const aiProviderSchema = z.enum(['openai', 'google'])
const openAiServiceTierSchema = z.enum(['auto', 'default', 'flex', 'scale', 'priority'])
const fileStorageKindSchema = z.enum(['local'])
const multiagentRuntimeProfileSchema = z.enum(['single_process'])
const mcpServerIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/)
const mcpWorkspaceScopeSchema = z.enum(['account', 'run'])
const mcpLoggingLevelSchema = z.enum([
  'alert',
  'critical',
  'debug',
  'emergency',
  'error',
  'info',
  'notice',
  'warning',
])
const mcpRecordSchema = z.record(z.string(), z.string())
const rawMcpHttpAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('bearer'),
    tokenEnv: z.string().trim().min(1),
  }),
  z.object({
    clientId: z.string().trim().min(1).optional(),
    clientName: z.string().trim().min(1).optional(),
    clientSecretEnv: z.string().trim().min(1).optional(),
    kind: z.literal('oauth_authorization_code'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
    tokenEndpointAuthMethod: z.string().trim().min(1).optional(),
  }),
  z.object({
    clientId: z.string().trim().min(1),
    clientSecretEnv: z.string().trim().min(1),
    kind: z.literal('oauth_client_credentials'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    algorithm: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_private_key_jwt'),
    privateKeyEnv: z.string().trim().min(1),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    assertionEnv: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_static_private_key_jwt'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
])
const rawMcpServerSchema = z.discriminatedUnion('kind', [
  z.object({
    allowedTenantIds: z.array(z.string().trim().min(1)).optional(),
    args: z.array(z.string()).optional(),
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    env: mcpRecordSchema.optional(),
    id: mcpServerIdSchema,
    kind: z.literal('stdio'),
    logLevel: mcpLoggingLevelSchema.optional(),
    stderr: z.enum(['inherit', 'pipe']).optional(),
    toolPrefix: mcpServerIdSchema.optional(),
    workspaceScoped: mcpWorkspaceScopeSchema.optional(),
  }),
  z.object({
    allowedTenantIds: z.array(z.string().trim().min(1)).optional(),
    auth: rawMcpHttpAuthSchema.optional(),
    enabled: z.boolean().optional(),
    headers: mcpRecordSchema.optional(),
    id: mcpServerIdSchema,
    kind: z.literal('streamable_http'),
    logLevel: mcpLoggingLevelSchema.optional(),
    toolPrefix: mcpServerIdSchema.optional(),
    url: z.string().url(),
  }),
])
const rawMcpServersSchema = z.array(rawMcpServerSchema)

const envSchema = z.object({
  API_BASE_PATH: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.string().optional(),
  AI_REQUEST_MAX_RETRIES: z.string().optional(),
  AI_REQUEST_TIMEOUT_MS: z.string().optional(),
  AUTH_METHODS: z.string().optional(),
  AUTH_MODE: z.string().optional(),
  AUTH_SESSION_COOKIE_NAME: z.string().optional(),
  AUTH_SESSION_MAX_AGE_SECONDS: z.string().optional(),
  AUTH_SESSION_SAME_SITE: z.string().optional(),
  AUTH_SESSION_SECURE: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional(),
  CORS_ALLOW_HEADERS: z.string().optional(),
  CORS_ALLOW_METHODS: z.string().optional(),
  CORS_ALLOW_ORIGINS: z.string().optional(),
  CORS_EXPOSE_HEADERS: z.string().optional(),
  CORS_MAX_AGE_SECONDS: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_API_VERSION: z.string().optional(),
  GOOGLE_BASE_URL: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_DEFAULT_MODEL: z.string().optional(),
  GOOGLE_VERTEXAI: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
  LANGFUSE_ENABLED: z.string().optional(),
  LANGFUSE_ENVIRONMENT: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_TIMEOUT_MS: z.string().optional(),
  MEMORY_COMPACTION_RAW_ITEMS: z.string().optional(),
  MEMORY_OBSERVATION_TAIL_RATIO: z.string().optional(),
  MEMORY_OBSERVATION_TRIGGER_RATIO: z.string().optional(),
  MEMORY_REFLECTION_TRIGGER_RATIO: z.string().optional(),
  FILE_ALLOWED_MIME_TYPES: z.string().optional(),
  FILE_INLINE_TEXT_BYTES: z.string().optional(),
  FILE_MAX_UPLOAD_BYTES: z.string().optional(),
  FILE_STORAGE_KIND: z.string().optional(),
  FILE_STORAGE_ROOT: z.string().optional(),
  HOST: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  MAX_REQUEST_BODY_BYTES: z.string().optional(),
  MULTIAGENT_LEASE_TTL_MS: z.string().optional(),
  MULTIAGENT_MAX_RUN_TURNS: z.string().optional(),
  MULTIAGENT_MAX_STALE_RECOVERIES: z.string().optional(),
  MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS: z.string().optional(),
  MULTIAGENT_WORKER_AUTO_START: z.string().optional(),
  MULTIAGENT_WORKER_POLL_MS: z.string().optional(),
  NODE_ENV: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().optional(),
  OPENAI_ORGANIZATION: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  OPENAI_SERVICE_TIER: z.string().optional(),
  OPENAI_WEBHOOK_SECRET: z.string().optional(),
  PORT: z.string().optional(),
  EVENT_STREAM_MAX_FOLLOW_MS: z.string().optional(),
  MCP_SERVERS_FILE: z.string().optional(),
  MCP_SECRET_ENCRYPTION_KEY: z.string().optional(),
})

const defaultCorsOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

const defaultCorsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const defaultCorsHeaders = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'X-Request-Id',
  'X-Tenant-Id',
  'X-Trace-Id',
]
const defaultCorsExposeHeaders = [
  'X-Api-Version',
  'X-Request-Id',
  'X-Response-Time-Ms',
  'X-Trace-Id',
]

const parseCsv = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback
  }

  const values = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error('Expected a non-empty comma-separated list')
  }

  return [...new Set(values)]
}

const parseInteger = (value: string | undefined, fallback: number, fieldName: string): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseInt(resolved, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }

  return parsed
}

const parseBoolean = (value: string | undefined, fallback: boolean, fieldName: string): boolean => {
  if (value === undefined) {
    return fallback
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`${fieldName} must be "true" or "false"`)
}

const parseNonNegativeInteger = (
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseInt(resolved, 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }

  return parsed
}

const parseOptionalString = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const parseUnitInterval = (
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseFloat(resolved)

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`${fieldName} must be a number between 0 and 1`)
  }

  return parsed
}

const parseBasePath = (value: string | undefined): string => {
  const basePath = value?.trim() || '/v1'

  if (!basePath.startsWith('/')) {
    throw new Error('API_BASE_PATH must start with "/"')
  }

  if (basePath.length > 1 && basePath.endsWith('/')) {
    throw new Error('API_BASE_PATH must not end with "/"')
  }

  return basePath
}

const parseJsonString = <TValue>(
  value: string | undefined,
  fallback: TValue,
  parser: (input: unknown) => TValue,
  fieldName: string,
): TValue => {
  if (!value) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value)
    return parser(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure'
    throw new Error(`${fieldName} is invalid: ${message}`)
  }
}

const deriveAuthMethodsFromMode = (authMode: z.infer<typeof authModeSchema>): AuthMethod[] => {
  switch (authMode) {
    case 'api_key':
      return ['api_key', 'auth_session']
    case 'disabled':
      return []
  }
}

const parseAuthMethods = (
  value: string | undefined,
  authMode: z.infer<typeof authModeSchema>,
): AuthMethod[] => {
  if (!value) {
    return deriveAuthMethodsFromMode(authMode)
  }

  const methods = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((method) => authMethodSchema.parse(method))

  return [...new Set(methods)]
}

const resolveMcpServers = (
  rawFilePath: string | undefined,
  env: NodeJS.ProcessEnv,
): McpServerConfig[] => {
  const configuredFilePath = rawFilePath?.trim()
  const filePath = resolve(process.cwd(), configuredFilePath || './.mcp-servers.json')
  const fileExists = existsSync(filePath)

  if (!fileExists) {
    if (configuredFilePath) {
      throw new Error(`MCP_SERVERS_FILE does not exist: ${filePath}`)
    }

    return []
  }

  const fileContents = readFileSync(filePath, 'utf8').trim()
  const parsed = parseJsonString(
    fileContents.length > 0 ? fileContents : '[]',
    [],
    (input) => rawMcpServersSchema.parse(input),
    `MCP_SERVERS_FILE (${filePath})`,
  )
  const serverIds = new Set<string>()
  const toolPrefixes = new Set<string>()

  return parsed.map<McpServerConfig>((server) => {
    if (serverIds.has(server.id)) {
      throw new Error(`MCP server id ${server.id} is duplicated`)
    }

    serverIds.add(server.id)

    const toolPrefix = server.toolPrefix ?? server.id

    if (toolPrefixes.has(toolPrefix)) {
      throw new Error(`MCP tool prefix ${toolPrefix} is duplicated`)
    }

    toolPrefixes.add(toolPrefix)

    if (server.kind === 'stdio') {
      return {
        allowedTenantIds: server.allowedTenantIds,
        args: server.args,
        command: server.command,
        cwd: server.cwd,
        enabled: server.enabled ?? true,
        env: server.env,
        id: server.id,
        kind: 'stdio',
        logLevel: server.logLevel,
        stderr: server.stderr ?? 'pipe',
        toolPrefix,
        workspaceScoped: server.workspaceScoped,
      }
    }

    const auth = server.auth ?? { kind: 'none' as const }

    switch (auth.kind) {
      case 'none':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth,
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
      case 'bearer':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth: {
            kind: 'bearer',
            token: parseOptionalString(env[auth.tokenEnv]),
          },
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
      case 'oauth_client_credentials':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth: {
            clientId: auth.clientId,
            clientSecret: parseOptionalString(env[auth.clientSecretEnv]),
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
      case 'oauth_authorization_code':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth: {
            clientId: parseOptionalString(auth.clientId),
            clientName: parseOptionalString(auth.clientName),
            clientSecret: parseOptionalString(
              auth.clientSecretEnv ? env[auth.clientSecretEnv] : undefined,
            ),
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
            tokenEndpointAuthMethod: parseOptionalString(auth.tokenEndpointAuthMethod),
          },
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
      case 'oauth_private_key_jwt':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth: {
            algorithm: auth.algorithm,
            clientId: auth.clientId,
            kind: auth.kind,
            privateKey: parseOptionalString(env[auth.privateKeyEnv]),
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
      case 'oauth_static_private_key_jwt':
        return {
          allowedTenantIds: server.allowedTenantIds,
          auth: {
            assertion: parseOptionalString(env[auth.assertionEnv]),
            clientId: auth.clientId,
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
          enabled: server.enabled ?? true,
          headers: server.headers,
          id: server.id,
          kind: 'streamable_http',
          logLevel: server.logLevel,
          toolPrefix,
          url: server.url,
        }
    }

    throw new Error(`Unsupported MCP auth kind ${(auth as { kind: string }).kind}`)
  })
}

export interface AppConfig {
  api: {
    basePath: string
    cors: {
      allowCredentials: boolean
      allowHeaders: string[]
      allowMethods: string[]
      allowOrigins: string[]
      exposeHeaders: string[]
      maxAgeSeconds: number
    }
    maxRequestBodyBytes: number
    version: string
  }
  ai: {
    defaults: {
      maxRetries: number
      model: string
      provider: AiProviderName
      timeoutMs: number
    }
    modelRegistry: AiModelRegistry
    providers: {
      google: {
        apiKey: string | null
        apiVersion: string | null
        baseUrl: string | null
        defaultModel: string
        location: string | null
        project: string | null
        vertexai: boolean
      }
      openai: {
        apiKey: string | null
        baseUrl: string | null
        defaultModel: string
        organization: string | null
        project: string | null
        serviceTier: z.infer<typeof openAiServiceTierSchema> | null
        webhookSecret: string | null
      }
    }
  }
  files: {
    allowedMimeTypes: string[]
    inlineTextBytes: number
    maxUploadBytes: number
    storage: {
      kind: z.infer<typeof fileStorageKindSchema>
      root: string
    }
  }
  auth: {
    methods: AuthMethod[]
    mode: z.infer<typeof authModeSchema>
    session: {
      cookieName: string
      maxAgeSeconds: number
      sameSite: z.infer<typeof authSessionSameSiteSchema>
      secure: boolean
    }
  }
  app: {
    env: z.infer<typeof nodeEnvSchema>
    name: string
  }
  database: {
    path: string
  }
  mcp: {
    secretEncryptionKey: string | null
    servers: McpServerConfig[]
  }
  memory: {
    compaction: {
      rawItemThreshold: number
      tailRatio: number
      triggerRatio: number
    }
    reflection: {
      triggerRatio: number
    }
  }
  multiagent: {
    leaseTtlMs: number
    maxRunTurns: number
    maxStaleRecoveries: number
    profile: z.infer<typeof multiagentRuntimeProfileSchema>
    staleRecoveryBaseDelayMs: number
    worker: {
      autoStart: boolean
      pollIntervalMs: number
    }
  }
  observability: {
    langfuse: {
      baseUrl: string | null
      enabled: boolean
      environment: string
      publicKey: string | null
      secretKey: string | null
      timeoutMs: number
    }
    logLevel: z.infer<typeof logLevelSchema>
  }
  server: {
    eventStreamMaxFollowMs: number
    host: string
    port: number
  }
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const raw = envSchema.parse(env)

  const nodeEnv = nodeEnvSchema.parse(raw.NODE_ENV ?? 'development')
  const defaultAuthMode = 'api_key'
  const authMode = authModeSchema.parse(raw.AUTH_MODE ?? defaultAuthMode)
  const authMethods = parseAuthMethods(raw.AUTH_METHODS, authMode)
  const authSessionSecure = parseBoolean(
    raw.AUTH_SESSION_SECURE,
    nodeEnv === 'production',
    'AUTH_SESSION_SECURE',
  )
  const authSessionCookieName =
    raw.AUTH_SESSION_COOKIE_NAME?.trim() ||
    (authSessionSecure ? '__Host-05_04_session' : '05_04_session')
  const authSessionMaxAgeSeconds = parseInteger(
    raw.AUTH_SESSION_MAX_AGE_SECONDS,
    60 * 60 * 24 * 30,
    'AUTH_SESSION_MAX_AGE_SECONDS',
  )
  const authSessionSameSite = authSessionSameSiteSchema.parse(raw.AUTH_SESSION_SAME_SITE ?? 'lax')
  const logLevel = logLevelSchema.parse(raw.LOG_LEVEL ?? 'info')
  const host = raw.HOST?.trim() || '127.0.0.1'
  const port = parseInteger(raw.PORT, 3000, 'PORT')
  const basePath = parseBasePath(raw.API_BASE_PATH)
  const allowOrigins = parseCsv(raw.CORS_ALLOW_ORIGINS, defaultCorsOrigins)
  const allowCredentials = parseBoolean(raw.CORS_ALLOW_CREDENTIALS, true, 'CORS_ALLOW_CREDENTIALS')
  const openAiDefaultModel = raw.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-5.4'
  const googleDefaultModel = raw.GOOGLE_DEFAULT_MODEL?.trim() || 'gemini-3.1-pro-preview'
  const defaultAiProvider = aiProviderSchema.parse(raw.AI_DEFAULT_PROVIDER ?? 'openai')
  const defaultAiModel =
    parseOptionalString(raw.AI_DEFAULT_MODEL) ??
    (defaultAiProvider === 'openai' ? openAiDefaultModel : googleDefaultModel)
  const aiTimeoutMs = parseInteger(raw.AI_REQUEST_TIMEOUT_MS, 60_000, 'AI_REQUEST_TIMEOUT_MS')
  const aiMaxRetries = parseNonNegativeInteger(
    raw.AI_REQUEST_MAX_RETRIES,
    2,
    'AI_REQUEST_MAX_RETRIES',
  )
  const maxRequestBodyBytes = parseInteger(
    raw.MAX_REQUEST_BODY_BYTES,
    1_048_576,
    'MAX_REQUEST_BODY_BYTES',
  )
  const fileMaxUploadBytes = parseInteger(
    raw.FILE_MAX_UPLOAD_BYTES,
    maxRequestBodyBytes,
    'FILE_MAX_UPLOAD_BYTES',
  )
  const memoryRawItemThreshold = parseInteger(
    raw.MEMORY_COMPACTION_RAW_ITEMS,
    200,
    'MEMORY_COMPACTION_RAW_ITEMS',
  )
  const memoryObservationTriggerRatio = parseUnitInterval(
    raw.MEMORY_OBSERVATION_TRIGGER_RATIO,
    0.3,
    'MEMORY_OBSERVATION_TRIGGER_RATIO',
  )
  const memoryObservationTailRatio = parseUnitInterval(
    raw.MEMORY_OBSERVATION_TAIL_RATIO,
    0.3,
    'MEMORY_OBSERVATION_TAIL_RATIO',
  )
  const memoryReflectionTriggerRatio = parseUnitInterval(
    raw.MEMORY_REFLECTION_TRIGGER_RATIO,
    0.6,
    'MEMORY_REFLECTION_TRIGGER_RATIO',
  )
  const multiagentWorkerPollIntervalMs = parseInteger(
    raw.MULTIAGENT_WORKER_POLL_MS,
    500,
    'MULTIAGENT_WORKER_POLL_MS',
  )
  const multiagentLeaseTtlMs = parseInteger(
    raw.MULTIAGENT_LEASE_TTL_MS,
    30_000,
    'MULTIAGENT_LEASE_TTL_MS',
  )
  const multiagentMaxRunTurns = parseInteger(
    raw.MULTIAGENT_MAX_RUN_TURNS,
    32,
    'MULTIAGENT_MAX_RUN_TURNS',
  )
  const multiagentMaxStaleRecoveries = parseNonNegativeInteger(
    raw.MULTIAGENT_MAX_STALE_RECOVERIES,
    5,
    'MULTIAGENT_MAX_STALE_RECOVERIES',
  )
  const multiagentStaleRecoveryBaseDelayMs = parseNonNegativeInteger(
    raw.MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS,
    1_000,
    'MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS',
  )
  const langfuseBaseUrl = parseOptionalString(raw.LANGFUSE_BASE_URL)
  const langfusePublicKey = parseOptionalString(raw.LANGFUSE_PUBLIC_KEY)
  const langfuseSecretKey = parseOptionalString(raw.LANGFUSE_SECRET_KEY)
  const langfuseConfigured =
    typeof langfuseBaseUrl === 'string' &&
    typeof langfusePublicKey === 'string' &&
    typeof langfuseSecretKey === 'string'
  const langfuseEnabled = parseBoolean(raw.LANGFUSE_ENABLED, langfuseConfigured, 'LANGFUSE_ENABLED')
  const langfuseTimeoutMs = parseInteger(raw.LANGFUSE_TIMEOUT_MS, 10_000, 'LANGFUSE_TIMEOUT_MS')
  const langfuseEnvironment = raw.LANGFUSE_ENVIRONMENT?.trim() || nodeEnv
  const multiagentWorkerAutoStart = parseBoolean(
    raw.MULTIAGENT_WORKER_AUTO_START,
    nodeEnv !== 'test',
    'MULTIAGENT_WORKER_AUTO_START',
  )
  const eventStreamMaxFollowMs = parseInteger(
    raw.EVENT_STREAM_MAX_FOLLOW_MS,
    5 * 60 * 1000,
    'EVENT_STREAM_MAX_FOLLOW_MS',
  )
  const aiModelRegistry: AiModelRegistry = {
    aliases: {
      default: {
        model: defaultAiModel,
        provider: defaultAiProvider,
      },
      'gemini-3.1-pro': {
        model: 'gemini-3.1-pro-preview',
        provider: 'google',
      },
      'gemini-3.1-flash-lite': {
        model: 'gemini-3.1-flash-lite-preview',
        provider: 'google',
      },
      google_default: {
        model: googleDefaultModel,
        provider: 'google',
      },
      openai_default: {
        model: openAiDefaultModel,
        provider: 'openai',
      },
    },
    defaultAlias: 'default',
  }

  if (allowOrigins.includes('*') && allowCredentials) {
    throw new Error('CORS_ALLOW_ORIGINS cannot include "*" when CORS_ALLOW_CREDENTIALS=true')
  }

  if (authSessionCookieName.startsWith('__Host-') && !authSessionSecure) {
    throw new Error(
      'AUTH_SESSION_COOKIE_NAME with "__Host-" prefix requires AUTH_SESSION_SECURE=true',
    )
  }

  if (langfuseEnabled && !langfuseConfigured) {
    throw new Error(
      'LANGFUSE_ENABLED=true requires LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY',
    )
  }

  return {
    api: {
      basePath,
      cors: {
        allowCredentials,
        allowHeaders: parseCsv(raw.CORS_ALLOW_HEADERS, defaultCorsHeaders),
        allowMethods: parseCsv(raw.CORS_ALLOW_METHODS, defaultCorsMethods),
        allowOrigins,
        exposeHeaders: parseCsv(raw.CORS_EXPOSE_HEADERS, defaultCorsExposeHeaders),
        maxAgeSeconds: parseInteger(raw.CORS_MAX_AGE_SECONDS, 600, 'CORS_MAX_AGE_SECONDS'),
      },
      maxRequestBodyBytes,
      version: 'v1',
    },
    ai: {
      defaults: {
        maxRetries: aiMaxRetries,
        model: defaultAiModel,
        provider: defaultAiProvider,
        timeoutMs: aiTimeoutMs,
      },
      modelRegistry: aiModelRegistry,
      providers: {
        google: {
          apiKey: parseOptionalString(raw.GOOGLE_API_KEY),
          apiVersion: parseOptionalString(raw.GOOGLE_API_VERSION),
          baseUrl: parseOptionalString(raw.GOOGLE_BASE_URL),
          defaultModel: googleDefaultModel,
          location: parseOptionalString(raw.GOOGLE_CLOUD_LOCATION),
          project: parseOptionalString(raw.GOOGLE_CLOUD_PROJECT),
          vertexai: parseBoolean(raw.GOOGLE_VERTEXAI, false, 'GOOGLE_VERTEXAI'),
        },
        openai: {
          apiKey: parseOptionalString(raw.OPENAI_API_KEY),
          baseUrl: parseOptionalString(raw.OPENAI_BASE_URL),
          defaultModel: openAiDefaultModel,
          organization: parseOptionalString(raw.OPENAI_ORGANIZATION),
          project: parseOptionalString(raw.OPENAI_PROJECT_ID),
          serviceTier: raw.OPENAI_SERVICE_TIER
            ? openAiServiceTierSchema.parse(raw.OPENAI_SERVICE_TIER)
            : null,
          webhookSecret: parseOptionalString(raw.OPENAI_WEBHOOK_SECRET),
        },
      },
    },
    files: {
      allowedMimeTypes: parseCsv(raw.FILE_ALLOWED_MIME_TYPES, [
        'image/*',
        'text/*',
        'application/pdf',
      ]),
      inlineTextBytes: parseInteger(raw.FILE_INLINE_TEXT_BYTES, 65_536, 'FILE_INLINE_TEXT_BYTES'),
      maxUploadBytes: fileMaxUploadBytes,
      storage: {
        kind: fileStorageKindSchema.parse(raw.FILE_STORAGE_KIND ?? 'local'),
        root: resolve(process.cwd(), raw.FILE_STORAGE_ROOT ?? './var/files'),
      },
    },
    auth: {
      methods: authMethods,
      mode: authMode,
      session: {
        cookieName: authSessionCookieName,
        maxAgeSeconds: authSessionMaxAgeSeconds,
        sameSite: authSessionSameSite,
        secure: authSessionSecure,
      },
    },
    app: {
      env: nodeEnv,
      name: '05_04_api',
    },
    database: {
      path: resolve(process.cwd(), raw.DATABASE_PATH ?? './var/05_04_api.sqlite'),
    },
    mcp: {
      secretEncryptionKey: parseOptionalString(raw.MCP_SECRET_ENCRYPTION_KEY),
      servers: resolveMcpServers(raw.MCP_SERVERS_FILE, env),
    },
    memory: {
      compaction: {
        rawItemThreshold: memoryRawItemThreshold,
        tailRatio: memoryObservationTailRatio,
        triggerRatio: memoryObservationTriggerRatio,
      },
      reflection: {
        triggerRatio: memoryReflectionTriggerRatio,
      },
    },
    multiagent: {
      leaseTtlMs: multiagentLeaseTtlMs,
      maxRunTurns: multiagentMaxRunTurns,
      maxStaleRecoveries: multiagentMaxStaleRecoveries,
      profile: multiagentRuntimeProfileSchema.parse('single_process'),
      staleRecoveryBaseDelayMs: multiagentStaleRecoveryBaseDelayMs,
      worker: {
        autoStart: multiagentWorkerAutoStart,
        pollIntervalMs: multiagentWorkerPollIntervalMs,
      },
    },
    observability: {
      langfuse: {
        baseUrl: langfuseBaseUrl,
        enabled: langfuseEnabled,
        environment: langfuseEnvironment,
        publicKey: langfusePublicKey,
        secretKey: langfuseSecretKey,
        timeoutMs: langfuseTimeoutMs,
      },
      logLevel,
    },
    server: {
      eventStreamMaxFollowMs,
      host,
      port,
    },
  }
}
