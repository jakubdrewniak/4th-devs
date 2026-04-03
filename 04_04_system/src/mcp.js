/*
  MCP client — connects to MCP servers defined in mcp.json over stdio.

  Each server exposes tools (e.g. fs_read, fs_write) that become available
  to the agent alongside local tools. Tool names are prefixed with the server
  name to avoid collisions: "files" server's "fs_read" → "files__fs_read".
*/

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const loadConfig = async () => {
  const raw = await readFile(join(PROJECT_ROOT, "mcp.json"), "utf-8");
  return JSON.parse(raw);
};

/* Spawn a stdio MCP server and return a connected client */
const connectServer = async (name, config) => {
  const client = new Client(
    { name: `04_04_system-${name}`, version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...config.env },
    cwd: PROJECT_ROOT,
    stderr: "inherit",
  });

  await client.connect(transport);
  return client;
};

/* Connect to all servers listed in mcp.json */
export const connect = async () => {
  const { mcpServers } = await loadConfig();
  const clients = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    clients[name] = await connectServer(name, config);
  }

  return clients;
};

/* List tools from all servers, prefixed with server name to avoid collisions */
export const listTools = async (clients) => {
  const tools = [];

  for (const [server, client] of Object.entries(clients)) {
    const { tools: serverTools } = await client.listTools();

    for (const tool of serverTools) {
      tools.push({
        server,
        originalName: tool.name,
        name: `${server}__${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }

  return tools;
};

/* Call an MCP tool by its prefixed name (e.g. "files__fs_read") */
export const callTool = async (clients, prefixedName, args) => {
  const [server, ...parts] = prefixedName.split("__");
  const client = clients[server];
  if (!client) throw new Error(`Unknown MCP server: ${server}`);

  const result = await client.callTool({ name: parts.join("__"), arguments: args });
  const text = result.content.find((c) => c.type === "text");
  if (!text) return result;

  try { return JSON.parse(text.text); } catch { return text.text; }
};

/* Convert MCP tool list to OpenAI function tool format */
export const toDefinitions = (mcpTools) =>
  mcpTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));

/* Close all connected clients */
export const close = async (clients) => {
  for (const client of Object.values(clients)) {
    try { await client.close(); } catch {}
  }
};
