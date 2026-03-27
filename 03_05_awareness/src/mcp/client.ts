import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { logger } from '../logger.js'
import type { McpConfig, McpServerConfig, McpToolInfo } from './types.js'

const SEPARATOR = '__'
const CALL_TIMEOUT_MS = 30_000

const loadMcpConfig = async (rootDir: string): Promise<McpConfig> => {
  const raw = await readFile(resolve(rootDir, '.mcp.json'), 'utf-8').catch(() => null)
  if (!raw) return { mcpServers: {} }
  return JSON.parse(raw) as McpConfig
}

const buildTransportEnv = (overrides?: Record<string, string>): Record<string, string> => {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

  return {
    ...inherited,
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_ENV: process.env.NODE_ENV ?? '',
    ...overrides,
  }
}

const createStdioTransport = (config: McpServerConfig, rootDir: string): StdioClientTransport =>
  new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: buildTransportEnv(config.env),
    cwd: config.cwd ?? rootDir,
    // Keep MCP server stderr out of the interactive chat stream.
    stderr: 'pipe',
  })

const extractText = (content: unknown): string => {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c != null && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string',
    )
    .map((c) => c.text)
    .join('\n')
}

const parsePrefixedName = (
  prefixedName: string,
): { server: string; tool: string } | undefined => {
  const idx = prefixedName.indexOf(SEPARATOR)
  if (idx === -1) return undefined
  return {
    server: prefixedName.slice(0, idx),
    tool: prefixedName.slice(idx + SEPARATOR.length),
  }
}

const mapTools = (
  serverName: string,
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
): McpToolInfo[] =>
  tools.map((tool) => ({
    server: serverName,
    originalName: tool.name,
    prefixedName: `${serverName}${SEPARATOR}${tool.name}`,
    description: tool.description,
    inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
  }))

export interface McpManager {
  servers(): string[]
  listTools(): Promise<McpToolInfo[]>
  callTool(prefixedName: string, args: Record<string, unknown>): Promise<string>
  parseName(prefixedName: string): { server: string; tool: string } | undefined
  close(): Promise<void>
}

export const createMcpManager = async (rootDir: string): Promise<McpManager> => {
  const config = await loadMcpConfig(rootDir)
  const clients = new Map<string, Client>()
  const transports = new Map<string, StdioClientTransport>()

  const entries = Object.entries(config.mcpServers)
  const results = await Promise.allSettled(
    entries.map(async ([name, serverConfig]) => {
      const client = new Client(
        { name: 'awareness-mcp-client', version: '1.0.0' },
        { capabilities: {} },
      )
      const transport = createStdioTransport(serverConfig, rootDir)
      transports.set(name, transport)
      await client.connect(transport)
      return { name, client }
    }),
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.set(result.value.name, result.value.client)
      logger.info('mcp.connected', { server: result.value.name })
      continue
    }
    logger.warn('mcp.connection_failed', { error: String(result.reason) })
  }

  const listTools = async (): Promise<McpToolInfo[]> => {
    const all = await Promise.all(
      [...clients.entries()].map(async ([name, client]) => {
        const result = await client.listTools()
        return mapTools(name, result.tools)
      }),
    )
    return all.flat()
  }

  const callTool = async (
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const parsed = parsePrefixedName(prefixedName)
    if (!parsed) throw new Error(`Invalid MCP tool name: ${prefixedName}`)

    const client = clients.get(parsed.server)
    if (!client) throw new Error(`MCP server not connected: ${parsed.server}`)

    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
    const result = await client.callTool(
      { name: parsed.tool, arguments: args },
      undefined,
      { signal: timeout },
    )

    if (result.isError) {
      const msg = extractText(result.content)
      throw new Error(msg || 'MCP tool returned an error')
    }

    if (result.structuredContent) {
      return JSON.stringify(result.structuredContent)
    }
    return extractText(result.content) || JSON.stringify(result.content)
  }

  const close = async (): Promise<void> => {
    const closeResults = await Promise.allSettled(
      [...clients.entries()].map(async ([name, client]) => {
        await client.close()
        logger.info('mcp.closed', { server: name })
      }),
    )

    for (const result of closeResults) {
      if (result.status === 'rejected') {
        logger.warn('mcp.close_failed', { error: String(result.reason) })
      }
    }

    clients.clear()
    transports.clear()
  }

  return {
    servers: () => [...clients.keys()],
    listTools,
    callTool,
    parseName: parsePrefixedName,
    close,
  }
}
