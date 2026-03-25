import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface TextContent { type: 'text'; text: string; }

export interface McpClientHandle {
  client: Client;
  close: () => Promise<void>;
}

const PROJECT_ROOT = resolve(import.meta.dirname ?? '.', '..');
const MCP_CONFIG_PATH = resolve(PROJECT_ROOT, 'mcp.json');

const isTextContent = (value: unknown): value is TextContent => {
  if (!value || typeof value !== 'object') return false;
  const c = value as { type?: unknown; text?: unknown };
  return c.type === 'text' && typeof c.text === 'string';
};

export const createMcpClient = async (serverName = 'files'): Promise<McpClientHandle> => {
  const raw = await readFile(MCP_CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw) as McpConfig;
  const server = config.mcpServers[serverName];
  if (!server) throw new Error(`MCP server "${serverName}" not found in mcp.json`);

  const client = new Client(
    { name: '03_03_browser-agent', version: '1.0.0' },
    { capabilities: {} },
  );

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
  });

  await client.connect(transport);
  return { client, close: async () => { await client.close().catch(() => {}); } };
};

export const listMcpTools = async (client: Client) => {
  const result = await client.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
};

export const callMcpTool = async (client: Client, name: string, args: Record<string, unknown>): Promise<unknown> => {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray((result as { content?: unknown }).content)
    ? (result as { content: unknown[] }).content
    : [];
  const text = content.find(isTextContent);
  if (!text) return result;
  try { return JSON.parse(text.text); } catch { return text.text; }
};
