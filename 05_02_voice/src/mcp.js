import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SEPARATOR = "__";
const CALL_TIMEOUT_MS = 30_000;

const loadConfig = async (rootDir) => {
  try {
    const raw = await readFile(path.join(rootDir, ".mcp.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { mcpServers: {} };
  }
};

const buildEnv = (overrides = {}) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => typeof v === "string"),
  ),
  ...overrides,
});

const extractText = (content) => {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
};

export const createMcpManager = async (rootDir) => {
  const config = await loadConfig(rootDir);
  const clients = new Map();

  const results = await Promise.allSettled(
    Object.entries(config.mcpServers).map(async ([name, cfg]) => {
      const client = new Client(
        { name: "05_02_voice-mcp", version: "1.0.0" },
        { capabilities: {} },
      );

      await client.connect(
        new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          cwd: cfg.cwd ?? rootDir,
          env: buildEnv(cfg.env),
          stderr: "inherit",
        }),
      );

      return { name, client };
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      clients.set(r.value.name, r.value.client);
      console.log(`[mcp] connected: ${r.value.name}`);
    } else {
      console.error("[mcp] failed:", r.reason);
    }
  }

  return {
    async listTools() {
      const batches = await Promise.all(
        [...clients.entries()].map(async ([name, client]) => {
          const { tools } = await client.listTools();
          return tools.map((t) => ({
            server: name,
            prefixedName: `${name}${SEPARATOR}${t.name}`,
            description: t.description,
            inputSchema: t.inputSchema ?? {},
          }));
        }),
      );
      return batches.flat();
    },
    async callTool(prefixedName, args, signal) {
      const idx = prefixedName.indexOf(SEPARATOR);
      if (idx === -1) throw new Error(`Invalid MCP tool: ${prefixedName}`);

      const serverName = prefixedName.slice(0, idx);
      const toolName = prefixedName.slice(idx + SEPARATOR.length);
      const client = clients.get(serverName);
      if (!client) throw new Error(`MCP server not connected: ${serverName}`);

      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS) },
      );

      if (result.isError) {
        throw new Error(extractText(result.content) || "MCP tool error");
      }

      return result.structuredContent
        ? JSON.stringify(result.structuredContent)
        : extractText(result.content) || JSON.stringify(result.content);
    },
    async close() {
      await Promise.allSettled([...clients.values()].map((c) => c.close()));
      clients.clear();
    },
  };
};
