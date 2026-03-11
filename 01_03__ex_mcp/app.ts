import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./src/mcp/server.js";
import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { runAgent, type Message } from "./src/agent.js";

// ─── Load .env from project root ─────────────────────────────────────────────

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = 3000;

// ─── Session store ────────────────────────────────────────────────────────────
// Each session keeps only user/assistant/tool turns (no system prompt).

const sessions = new Map<string, Message[]>();

// ─── Bootstrap MCP ───────────────────────────────────────────────────────────

let mcpClient: Client;
let mcpTools: Tool[];

const initMcp = async () => {
  const mcpServer = createMcpServer();
  mcpClient = await createMcpClient(mcpServer);
  mcpTools = await listMcpTools(mcpClient);
  console.log(`[MCP] ready — tools: ${mcpTools.map((t) => t.name).join(", ")}`);
};

// ─── Request handler ──────────────────────────────────────────────────────────

const readBody = (
  req: Parameters<typeof createServer>[1] extends (...a: infer A) => unknown
    ? A[0]
    : never,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });

const sendJson = (
  res: Parameters<typeof createServer>[1] extends (...a: infer A) => unknown
    ? A[1]
    : never,
  status: number,
  body: unknown,
) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
};

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method Not Allowed" });
    return;
  }

  let body: { sessionID?: string; msg?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const { sessionID, msg } = body;
  if (!sessionID || !msg) {
    sendJson(res, 400, { error: "Missing sessionID or msg" });
    return;
  }

  console.log(`\n[HTTP] session=${sessionID} msg="${msg}"`);

  const history = sessions.get(sessionID) ?? [];

  try {
    const { reply, history: updatedHistory } = await runAgent(
      history,
      msg,
      mcpClient,
      mcpTools,
    );
    sessions.set(sessionID, updatedHistory);
    sendJson(res, 200, { msg: reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[HTTP] error for session=${sessionID}:`, message);
    sendJson(res, 500, { error: message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

initMcp()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[HTTP] listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[startup] MCP init failed:", err);
    process.exit(1);
  });
