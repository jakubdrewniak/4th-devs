import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { runAgent } from './agent/run.js'
import { getSession, listSessions } from './session.js'
import {
  flush,
  setTraceOutput,
  withTrace,
} from './core/tracing/index.js'
import type { AppDeps } from './types.js'

interface ChatBody {
  session_id?: unknown
  user_id?: unknown
  message?: unknown
}

export const createApp = ({ logger, adapterResolver }: AppDeps): Hono => {
  const app = new Hono()
  app.use(cors())

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      service: '03_01_evals',
      tracing: process.env.LANGFUSE_PUBLIC_KEY ? 'configured' : 'not_configured',
    })
  })

  app.get('/api/sessions', (c) => {
    return c.json(listSessions())
  })

  app.post('/api/chat', async (c) => {
    const body = await c.req.json<ChatBody>()
    const sessionId = typeof body.session_id === 'string' ? body.session_id : randomUUID()
    const userId = typeof body.user_id === 'string' ? body.user_id : undefined
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    if (!message) {
      return c.json({ error: 'message is required' }, 400)
    }

    const adapter = adapterResolver('openai')
    if (!adapter.ok) {
      return c.json({ error: adapter.error.message }, 503)
    }

    const session = getSession(sessionId)

    try {
      const result = await withTrace(
        {
          name: 'chat-request',
          sessionId,
          userId,
          input: message,
          metadata: { provider: 'openai', stream: false },
          tags: ['chat', 'openai', 'sync'],
        },
        async () => {
          const run = await runAgent({
            adapter: adapter.value,
            logger,
            session,
            message,
          })

          setTraceOutput(run.response)
          return run
        },
      )

      return c.json({
        session_id: sessionId,
        response: result.response,
        turns: result.turns,
        usage: result.usage,
        history: session.messages.length,
      })
    } catch (error) {
      logger.error('Chat execution failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      })

      return c.json(
        {
          error: 'Agent execution failed',
          detail: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    } finally {
      await flush()
    }
  })

  return app
}
