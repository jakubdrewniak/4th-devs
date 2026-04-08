import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { MCP_CONFIG_PATH, PROJECT_ROOT } from './config.js'
import type { Logger } from './logger.js'

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

interface ToolDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpHandle {
  tools: Array<{
    type: 'function'
    name: string
    description: string
    parameters: Record<string, unknown>
    strict: false
  }>
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
}

const isTextContent = (value: unknown): value is { type: 'text'; text: string } =>
  Boolean(
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>).type === 'text'
    && typeof (value as Record<string, unknown>).text === 'string',
  )

export const connectMcp = async (serverName = 'files', logger?: Logger): Promise<McpHandle> => {
  const raw = await readFile(MCP_CONFIG_PATH, 'utf-8')
  const config = JSON.parse(raw) as McpConfig
  const server = config.mcpServers[serverName]

  if (!server) {
    throw new Error(`MCP server "${serverName}" not found in mcp.json`)
  }

  const client = new Client(
    { name: '05_03_coding-agent', version: '2.0.0' },
    { capabilities: {} },
  )

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: process.env.NODE_ENV ?? '',
      ...(server.env ?? {}),
    },
    cwd: server.cwd ? resolve(PROJECT_ROOT, server.cwd) : PROJECT_ROOT,
    stderr: 'pipe',
  })

  await client.connect(transport)

  const listed = await client.listTools()
  const tools = listed.tools.map((tool: ToolDescriptor) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    strict: false as const,
  }))

  logger?.info('mcp', `Connected to "${serverName}" with ${tools.length} tool(s)`)

  return {
    tools,
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      const content = Array.isArray((result as Record<string, unknown>).content)
        ? (result as { content: unknown[] }).content
        : []
      const text = content.find(isTextContent)

      return text?.text ?? JSON.stringify(result)
    },
    close: async () => {
      await client.close().catch(() => {})
    },
  }
}
