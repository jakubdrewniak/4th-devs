import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../config.js'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { adapters } from './core/adapters/index.js'
import { createLogger } from './core/logger.js'
import {
  initTracing,
  shutdownTracing,
  syncPrompts,
} from './core/tracing/index.js'

const logger = createLogger({ service: '03_01_observability' })

initTracing({ logger, serviceName: '03_01_observability' })

await syncPrompts().catch((error) => {
  logger.warn('Prompt sync failed; continuing without prompt refs', {
    error: error instanceof Error ? error.message : String(error),
  })
})

const adapterResolver = adapters({
  openai: AI_API_KEY
    ? { apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS }
    : undefined,
  logger,
})

const app = createApp({ logger, adapterResolver })

const port = parseInt(process.env.PORT ?? '3000', 10)
const host = `http://localhost:${port}`

serve({ fetch: app.fetch, port }, (info) => {
  logger.info('Server started', {
    port: info.port,
    tracing: process.env.LANGFUSE_PUBLIC_KEY ? 'enabled' : 'disabled',
  })

  console.log(`
  ───────────────────────────────────────────
  03_01_observability server listening on ${host}
  ───────────────────────────────────────────

  Endpoints:

    GET  ${host}/api/health
    GET  ${host}/api/sessions
    POST ${host}/api/chat

  Curl examples:

    # Health check
    curl ${host}/api/health

    # Send a message
    curl -X POST ${host}/api/chat \\
      -H "Content-Type: application/json" \\
      -d '{"message": "What time is it?", "session_id": "test-1"}'

    # Multi-turn conversation (reuse session_id)
    curl -X POST ${host}/api/chat \\
      -H "Content-Type: application/json" \\
      -d '{"message": "Now sum 3, 11, 21", "session_id": "test-1"}'

    # List active sessions
    curl ${host}/api/sessions

  ───────────────────────────────────────────
`)
})

const shutdown = async (signal: string): Promise<void> => {
  logger.info('Shutdown signal received', { signal })
  await shutdownTracing()
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
