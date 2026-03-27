import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { readListsState, type ListsFilePaths, summarizeLists, writeListsState } from './list-files.js'
import { renderListManagerHtml } from './ui-html.js'
import type { ManagerFocus } from '../types.js'

export interface McpAppServerRuntime {
  readonly url: string
  stop: () => void
}

interface StartMcpAppServerInput extends ListsFilePaths {
  host: string
  port: number
  resourceUri: string
}

const parseFocus = (value: unknown): ManagerFocus => {
  if (value === 'todo' || value === 'shopping') return value
  return 'todo'
}

const toStructuredContent = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>

export const startMcpAppServer = (input: StartMcpAppServerInput): McpAppServerRuntime => {
  const mcp = new McpServer({
    name: '03_05_apps_mcp',
    version: '1.0.0',
    description: 'Manage todo and shopping lists with an MCP App UI.',
  })

  registerAppTool(
    mcp,
    'manage_lists',
    {
      title: 'Manage lists',
      description: 'Open interactive UI focused on one list (todo or shopping).',
      inputSchema: {
        focus: z.enum(['todo', 'shopping']).optional(),
      },
      _meta: {
        ui: {
          resourceUri: input.resourceUri,
        },
      },
    },
    async (args) => {
      const focus = parseFocus(args.focus)
      const state = await readListsState(input)
      return {
        content: [
          {
            type: 'text',
            text: `Opened list manager (${focus}). ${summarizeLists(state)}`,
          },
        ],
        structuredContent: toStructuredContent({
          focus,
          ...state,
        }),
      }
    },
  )

  mcp.registerTool(
    'get_lists_state',
    {
      title: 'Get lists state',
      description: 'Read current todo and shopping lists from markdown files.',
      inputSchema: {},
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    async () => {
      const state = await readListsState(input)
      return {
        content: [{ type: 'text', text: summarizeLists(state) }],
        structuredContent: toStructuredContent(state),
      }
    },
  )

  mcp.registerTool(
    'save_lists_state',
    {
      title: 'Save lists state',
      description: 'Persist todo and shopping list updates to markdown files.',
      inputSchema: {
        todo: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional(),
        shopping: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional(),
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    async (args) => {
      const saved = await writeListsState(input, {
        todo: args.todo ?? [],
        shopping: args.shopping ?? [],
      })
      return {
        content: [{ type: 'text', text: `Saved. ${summarizeLists(saved)}` }],
        structuredContent: toStructuredContent(saved),
      }
    },
  )

  registerAppResource(
    mcp,
    'List Manager UI',
    input.resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => {
      const html = await renderListManagerHtml()
      return {
        contents: [
          {
            uri: input.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                prefersBorder: true,
              },
            },
          },
        ],
      }
    },
  )

  const server = Bun.serve({
    hostname: input.host,
    port: input.port,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/mcp') {
        return new Response('MCP endpoint: /mcp', { status: 200 })
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })

      await mcp.connect(transport)
      return transport.handleRequest(request)
    },
  })

  const resolvedHost = input.host === '0.0.0.0' ? '127.0.0.1' : input.host
  const url = `http://${resolvedHost}:${server.port}/mcp`

  return {
    url,
    stop: () => server.stop(true),
  }
}
