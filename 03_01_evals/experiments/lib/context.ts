import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../../config.js'
import { LangfuseClient } from '@langfuse/client'
import { adapters } from '../../src/core/adapters/index.js'
import { createLogger, type Logger } from '../../src/core/logger.js'
import {
  initTracing,
  shutdownTracing,
  syncPrompts,
} from '../../src/core/tracing/index.js'
import type { Adapter } from '../../src/types.js'

export interface ExperimentContext {
  logger: Logger
  adapter: Adapter
  langfuse: LangfuseClient
  shutdown: () => Promise<void>
}

interface BootstrapParams {
  experimentName: string
}

export const bootstrap = async (params: BootstrapParams): Promise<ExperimentContext> => {
  const logger = createLogger({ service: '03_01_evals', experiment: params.experimentName })

  initTracing({
    logger,
    serviceName: `03_01_evals_${params.experimentName}`,
  })

  await syncPrompts().catch((error) => {
    logger.warn('Prompt sync failed in experiment mode', {
      error: error instanceof Error ? error.message : String(error),
    })
  })

  const getAdapter = adapters({
    openai: AI_API_KEY
      ? { apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS }
      : undefined,
    logger,
  })

  const adapter = getAdapter('openai')
  if (!adapter.ok) {
    throw new Error(`Adapter unavailable: ${adapter.error.message}`)
  }

  const langfuse = new LangfuseClient()

  const shutdown = async (): Promise<void> => {
    await Promise.all([
      langfuse.flush().catch(() => {}),
      shutdownTracing(),
      langfuse.shutdown().catch(() => {}),
    ])
  }

  return {
    logger,
    adapter: adapter.value,
    langfuse,
    shutdown,
  }
}
