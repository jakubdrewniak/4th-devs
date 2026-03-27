export interface McpServerConfig {
  transport?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

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
