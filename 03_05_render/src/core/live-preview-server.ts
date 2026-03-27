import type { PreviewState } from '../types.js'
import { renderWebUi } from './web-ui.js'

export interface LivePreviewServer {
  readonly url: string
  getState: () => PreviewState
  updateState: (patch: Partial<Omit<PreviewState, 'updatedAt'>>) => PreviewState
  stop: () => void
}

interface StartLivePreviewServerInput {
  host: string
  port: number
}

const nowIso = (): string => new Date().toISOString()

const initialState = (): PreviewState => ({
  status: 'idle',
  phase: 'idle',
  message: 'Waiting for prompt in CLI...',
  lastPrompt: null,
  lastAssistantMessage: null,
  document: null,
  error: null,
  updatedAt: nowIso(),
})

const statePacket = (state: PreviewState): string =>
  JSON.stringify({
    type: 'preview_state',
    state,
  })

export const startLivePreviewServer = ({ host, port }: StartLivePreviewServerInput): LivePreviewServer => {
  const clients = new Set<Bun.ServerWebSocket<unknown>>()
  let state = initialState()

  const broadcast = (): void => {
    const packet = statePacket(state)
    for (const client of clients) {
      try {
        client.send(packet)
      } catch {
        clients.delete(client)
      }
    }
  }

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: (request, serverRef) => {
      const url = new URL(request.url)

      if (url.pathname === '/ws') {
        const upgraded = serverRef.upgrade(request)
        if (upgraded) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      if (url.pathname === '/state') {
        return new Response(JSON.stringify(state, null, 2), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(renderWebUi(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }

      return new Response('Not found', { status: 404 })
    },
    websocket: {
      open: (ws) => {
        clients.add(ws)
        ws.send(statePacket(state))
      },
      close: (ws) => {
        clients.delete(ws)
      },
      message: () => {
        // Browser currently does not send messages.
      },
    },
  })

  const resolvedHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const url = `http://${resolvedHost}:${server.port}`

  return {
    url,
    getState: () => state,
    updateState: (patch) => {
      state = {
        ...state,
        ...patch,
        updatedAt: nowIso(),
      }
      broadcast()
      return state
    },
    stop: () => {
      clients.clear()
      server.stop(true)
    },
  }
}
