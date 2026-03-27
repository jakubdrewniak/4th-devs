import { readListsState, type ListsFilePaths, writeListsState } from './list-files.js'
import { renderListManagerHtml } from './ui-html.js'

export interface UiServer {
  readonly url: string
  readonly resourceUri: string
  stop: () => void
}

interface StartUiServerInput extends ListsFilePaths {
  host: string
  port: number
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export const startUiServer = (input: StartUiServerInput): UiServer => {
  const server = Bun.serve({
    hostname: input.host,
    port: input.port,
    fetch: async (request) => {
      const url = new URL(request.url)

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/mcp-app.html')) {
        try {
          return new Response(await renderListManagerHtml(), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : String(error),
            { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
          )
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/state') {
        const state = await readListsState(input)
        return json(state)
      }

      if (request.method === 'POST' && url.pathname === '/api/save') {
        try {
          const payload = await request.json()
          const saved = await writeListsState(input, {
            todo: (payload as Record<string, unknown>)?.todo,
            shopping: (payload as Record<string, unknown>)?.shopping,
          })
          return json(saved)
        } catch (error) {
          return json(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            400,
          )
        }
      }

      return new Response('Not found', { status: 404 })
    },
  })

  const resolvedHost = input.host === '0.0.0.0' ? '127.0.0.1' : input.host
  const baseUrl = `http://${resolvedHost}:${server.port}`

  return {
    url: baseUrl,
    resourceUri: 'ui://lists/manager.html',
    stop: () => server.stop(true),
  }
}
