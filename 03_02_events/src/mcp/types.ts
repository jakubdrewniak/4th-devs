export interface McpStdioServer {
  transport?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type McpServerConfig = McpStdioServer

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

export interface McpToolInfo {
  server: string
  originalName: string
  prefixedName: string
  description?: string
  inputSchema: Record<string, unknown>
}
