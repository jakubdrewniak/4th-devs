import { resolve } from 'node:path'
import { createGoogleProvider } from '../adapters/ai/google/google-provider'
import { createOpenAiProvider } from '../adapters/ai/openai/openai-provider'
import { createLocalBlobStore } from '../adapters/blob/local-blob-store'
import { createMcpGateway } from '../adapters/mcp/gateway'
import type { McpGateway, McpServerConfig } from '../adapters/mcp/types'
import {
  createLangfuseExporter,
  type LangfuseExporter,
} from '../adapters/observability/langfuse/exporter'
import { registerAgentNativeTools } from '../application/agents/register-agent-native-tools'
import { registerOutboxWakeListener } from '../application/events/outbox-signal'
import {
  createEventOutboxWorker,
  createObservabilityOutboxWorker,
  type EventOutboxWorker,
} from '../application/events/outbox-worker'
import {
  createRealtimeEventRelay,
  type RealtimeEventRelay,
} from '../application/events/realtime-relay'
import {
  type AiInteractionService,
  createAiInteractionService,
} from '../application/interactions/interaction-service'
import {
  type ActiveRunRegistry,
  createActiveRunRegistry,
} from '../application/runtime/active-run-registry'
import {
  createMultiagentWorker,
  type MultiagentWorker,
} from '../application/runtime/multiagent-worker'
import { type AppDatabase, createDatabaseClient } from '../db/client'
import type { AiModelRegistry } from '../domain/ai/types'
import type { BlobStore } from '../domain/files/blob-store'
import { createToolRegistry, type ToolRegistry } from '../domain/tooling/tool-registry'
import { createPrefixedId } from '../shared/ids'
import { type AppLogger, createLogger } from '../shared/logger'
import { type Clock, createSystemClock } from '../shared/time'
import type { AppConfig } from './config'

export interface AppServices {
  activeRuns: ActiveRunRegistry
  ai: {
    interactions: AiInteractionService
    modelRegistry: AiModelRegistry
    providers: {
      google: ReturnType<typeof createGoogleProvider>
      openai: ReturnType<typeof createOpenAiProvider>
    }
  }
  clock: Clock
  events: {
    outbox: EventOutboxWorker
    realtime: RealtimeEventRelay
  }
  files: {
    blobStore: BlobStore
  }
  ids: {
    create: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  }
  logger: AppLogger
  mcp: McpGateway
  multiagent: MultiagentWorker
  observability: {
    langfuse: LangfuseExporter
    worker: EventOutboxWorker
  }
  tools: ToolRegistry
}

export interface AppRuntime {
  config: AppConfig
  db: AppDatabase
  services: AppServices
}

const outboxWakeCleanup = new WeakMap<AppRuntime, () => void>()

const requireInitializedService = <TValue>(value: TValue | null, name: string): TValue => {
  if (value) {
    return value
  }

  throw new Error(`${name} was accessed before runtime initialization completed`)
}

export const resolveRuntimeMcpServers = (
  servers: McpServerConfig[],
  fileStorageRoot: string,
): McpServerConfig[] => {
  const workspacesRoot = resolve(fileStorageRoot, '..', 'workspaces')

  return servers.map((server) => {
    if (server.kind !== 'stdio' || !server.workspaceScoped) {
      return server
    }

    const { FS_ROOT: _legacyFsRoot, ...serverEnv } = server.env ?? {}

    return {
      ...server,
      env: {
        ...serverEnv,
        FS_ROOTS: workspacesRoot,
      },
    }
  })
}

export const createAppRuntime = (config: AppConfig): AppRuntime => {
  const db = createDatabaseClient(config)
  const openaiProvider = createOpenAiProvider({
    apiKey: config.ai.providers.openai.apiKey,
    baseUrl: config.ai.providers.openai.baseUrl,
    defaultServiceTier: config.ai.providers.openai.serviceTier,
    maxRetries: config.ai.defaults.maxRetries,
    organization: config.ai.providers.openai.organization,
    project: config.ai.providers.openai.project,
    timeoutMs: config.ai.defaults.timeoutMs,
    webhookSecret: config.ai.providers.openai.webhookSecret,
  })
  const googleProvider = createGoogleProvider({
    apiKey: config.ai.providers.google.apiKey,
    apiVersion: config.ai.providers.google.apiVersion,
    baseUrl: config.ai.providers.google.baseUrl,
    defaultHttpTimeoutMs: config.ai.defaults.timeoutMs,
    location: config.ai.providers.google.location,
    maxRetries: config.ai.defaults.maxRetries,
    project: config.ai.providers.google.project,
    vertexai: config.ai.providers.google.vertexai,
  })
  const providers = {
    google: googleProvider,
    openai: openaiProvider,
  }
  const blobStore = createLocalBlobStore({
    root: resolve(config.files.storage.root, '..'),
  })
  const logger = createLogger(config.observability.logLevel)
  const langfuse = createLangfuseExporter({
    config: config.observability.langfuse,
    db,
    logger,
  })
  const tools = createToolRegistry()
  const realtime = createRealtimeEventRelay()
  registerAgentNativeTools(tools, {
    db,
    fileStorageRoot: config.files.storage.root,
  })
  const mcp = createMcpGateway({
    clientInfo: {
      name: config.app.name,
      version: config.api.version,
    },
    db,
    logger,
    secretEncryptionKey: config.mcp.secretEncryptionKey,
    servers: resolveRuntimeMcpServers(config.mcp.servers, config.files.storage.root),
    toolRegistry: tools,
  })
  const aiInteractions = createAiInteractionService({
    providers,
    registry: config.ai.modelRegistry,
  })
  const activeRuns = createActiveRunRegistry()
  const clock = createSystemClock()
  const ids = {
    create: createPrefixedId,
  }
  const workerRefs: {
    multiagent: MultiagentWorker | null
    observabilityOutbox: EventOutboxWorker | null
    outbox: EventOutboxWorker | null
  } = {
    multiagent: null,
    observabilityOutbox: null,
    outbox: null,
  }
  const services: AppServices = {
    activeRuns,
    ai: {
      interactions: aiInteractions,
      modelRegistry: config.ai.modelRegistry,
      providers,
    },
    clock,
    events: {
      get outbox() {
        return requireInitializedService(workerRefs.outbox, 'event outbox worker')
      },
      realtime,
    },
    files: {
      blobStore,
    },
    ids,
    logger,
    mcp,
    get multiagent() {
      return requireInitializedService(workerRefs.multiagent, 'multiagent worker')
    },
    observability: {
      langfuse,
      get worker() {
        return requireInitializedService(workerRefs.observabilityOutbox, 'observability outbox worker')
      },
    },
    tools,
  }
  const outbox = createEventOutboxWorker({
    backgroundRuntime: {
      config,
      db,
      services,
    },
    clock,
    config,
    db,
    logger,
    observability: {
      langfuse,
    },
    projectionRuntime: {
      config,
      db,
      services,
    },
    realtime,
  })
  const observabilityOutbox = createObservabilityOutboxWorker({
    backgroundRuntime: {
      config,
      db,
      services,
    },
    clock,
    config,
    db,
    logger,
    observability: {
      langfuse,
    },
    projectionRuntime: {
      config,
      db,
      services,
    },
    realtime,
  })
  const multiagent = createMultiagentWorker({
    config,
    db,
    services,
  })
  workerRefs.outbox = outbox
  workerRefs.observabilityOutbox = observabilityOutbox
  workerRefs.multiagent = multiagent

  const runtime = {
    config,
    db,
    services,
  }

  outboxWakeCleanup.set(
    runtime,
    registerOutboxWakeListener(() => {
      outbox.wake()
      observabilityOutbox.wake()
    }),
  )

  return runtime
}

export const initializeAppRuntime = async (runtime: AppRuntime): Promise<AppRuntime> => {
  const reconciledOutbox = runtime.services.events.outbox.reconcileProcessingEntries()

  if (!reconciledOutbox.ok) {
    throw new Error(reconciledOutbox.error.message)
  }

  const reconciledObservabilityOutbox = runtime.services.observability.worker.reconcileProcessingEntries()

  if (!reconciledObservabilityOutbox.ok) {
    throw new Error(reconciledObservabilityOutbox.error.message)
  }

  const reconciledStartup = await runtime.services.multiagent.reconcileDecisions({
    mode: 'startup',
  })

  if (!reconciledStartup.ok) {
    throw new Error(reconciledStartup.error.message)
  }

  await runtime.services.mcp.initialize()
  if (runtime.config.app.env !== 'test') {
    runtime.services.events.outbox.start()
    runtime.services.observability.worker.start()
  }
  if (
    runtime.config.multiagent.profile === 'single_process' &&
    runtime.config.multiagent.worker.autoStart
  ) {
    runtime.services.multiagent.start()
  }
  return runtime
}

export const closeAppRuntime = async (runtime: AppRuntime): Promise<void> => {
  outboxWakeCleanup.get(runtime)?.()
  outboxWakeCleanup.delete(runtime)
  await runtime.services.events.outbox.stop()
  await runtime.services.observability.worker.stop()
  await runtime.services.multiagent.stop()
  await runtime.services.mcp.close()
  await runtime.services.observability.langfuse.shutdown()
  runtime.db.close()
}
