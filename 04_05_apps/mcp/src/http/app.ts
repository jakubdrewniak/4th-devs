import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Hono } from "hono";

import { buildServer } from "../core/mcp.js";
import { MemorySessionStore } from "../shared/storage/memory.js";
import { healthRoutes } from "./routes/health.js";
import { buildMcpRoutes } from "./routes/mcp.js";

export type SessionConnection = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

export const buildHttpApp = (): {
  app: Hono<{ Bindings: HttpBindings }>;
  sessionStore: MemorySessionStore;
} => {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const connections = new Map<string, SessionConnection>();
  const sessionStore = new MemorySessionStore();

  app.route("/", healthRoutes());
  app.route("/mcp", buildMcpRoutes({ createServer: buildServer, connections, sessionStore }));

  return {
    app,
    sessionStore,
  };
};
