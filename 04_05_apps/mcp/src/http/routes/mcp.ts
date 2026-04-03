import { randomUUID } from "node:crypto";
import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { Hono } from "hono";

import type { MemorySessionStore } from "../../shared/storage/memory.js";
import type { SessionConnection } from "../app.js";

type JsonRpcLike = {
  method?: string;
  params?: Record<string, unknown>;
};

const MCP_SESSION_HEADER = "Mcp-Session-Id";

const getJsonRpcMessages = (body: unknown): JsonRpcLike[] => {
  if (!body || typeof body !== "object") {
    return [];
  }

  if (Array.isArray(body)) {
    return body.filter((message) => message && typeof message === "object") as JsonRpcLike[];
  }

  return [body as JsonRpcLike];
};

const jsonRpcError = (message: string, code = -32000) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});

const closeTransport = (transport?: StreamableHTTPServerTransport): void => {
  if (!transport) {
    return;
  }

  void transport.close();
};

export const buildMcpRoutes = (params: {
  createServer: () => McpServer;
  connections: Map<string, SessionConnection>;
  sessionStore: MemorySessionStore;
}) => {
  const { createServer, connections, sessionStore } = params;
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.post("/", async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    let createdConnection: SessionConnection | null = null;

    try {
      const sessionIdHeader = c.req.header(MCP_SESSION_HEADER) ?? undefined;
      let body: unknown;

      try {
        body = await c.req.json();
      } catch {
        body = undefined;
      }

      const messages = getJsonRpcMessages(body);
      const isInitialize = messages.some((message) => message.method === "initialize");
      const isInitialized = messages.some((message) => message.method === "initialized");
      const initMessage = messages.find((message) => message.method === "initialize");
      const firstMethod = messages[0]?.method ?? "unknown";
      const protocolVersion = typeof initMessage?.params?.protocolVersion === "string"
        ? initMessage.params.protocolVersion
        : undefined;

      if (!isInitialize && !sessionIdHeader) {
        return c.json(jsonRpcError("Bad Request: Mcp-Session-Id required"), 400);
      }

      const plannedSessionId = isInitialize ? randomUUID() : undefined;
      const sessionId = plannedSessionId ?? sessionIdHeader;

      console.log(`[04_05_apps/mcp] POST ${firstMethod} session=${sessionId ?? "new"}`);

      if (!isInitialize && sessionIdHeader) {
        const existingSession = await sessionStore.get(sessionIdHeader);
        if (!existingSession) {
          const staleConnection = connections.get(sessionIdHeader);
          connections.delete(sessionIdHeader);
          closeTransport(staleConnection?.transport);
          void staleConnection?.server.close();
          return c.text("Invalid session", 404);
        }
      }

      if (sessionId && isInitialized) {
        await sessionStore.update(sessionId, { initialized: true });
      }

      let connection = sessionIdHeader ? connections.get(sessionIdHeader) : undefined;
      if (!connection) {
        if (!isInitialize) {
          return c.text("Invalid session", 404);
        }

        const server = createServer();
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId as string,
          onsessioninitialized: async (sid: string) => {
            connections.set(sid, { server, transport: created });
            await sessionStore.create(sid, "public");
            if (protocolVersion) {
              await sessionStore.update(sid, { protocolVersion });
            }
            console.log(`[04_05_apps/mcp] session initialized ${sid}`);
          },
          onsessionclosed: (sid: string) => {
            const activeConnection = connections.get(sid);
            connections.delete(sid);
            void sessionStore.delete(sid);
            void activeConnection?.server.close();
            console.log(`[04_05_apps/mcp] session closed ${sid}`);
          },
        });

        createdConnection = { server, transport: created };
        connection = createdConnection;
        await server.connect(created);
      }

      connection.transport.onerror = (error) => {
        console.error("[04_05_apps/mcp] transport error:", error.message);
      };

      await connection.transport.handleRequest(req, res, body);
      return toFetchResponse(res);
    } catch (error) {
      if (createdConnection) {
        closeTransport(createdConnection.transport);
        void createdConnection.server.close();
      }
      console.error("[04_05_apps/mcp] POST /mcp failed:", error);
      return c.json(jsonRpcError("Internal server error", -32603), 500);
    }
  });

  app.get("/", async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const sessionId = c.req.header(MCP_SESSION_HEADER);

    if (!sessionId) {
      return c.json(jsonRpcError("Method not allowed - no session"), 405);
    }

    try {
      console.log(`[04_05_apps/mcp] GET stream session=${sessionId}`);
      const session = await sessionStore.get(sessionId);
      if (!session) {
        const staleConnection = connections.get(sessionId);
        connections.delete(sessionId);
        closeTransport(staleConnection?.transport);
        void staleConnection?.server.close();
        return c.text("Invalid session", 404);
      }

      const connection = connections.get(sessionId);
      if (!connection) {
        return c.text("Invalid session", 404);
      }

      await connection.transport.handleRequest(req, res);
      return toFetchResponse(res);
    } catch (error) {
      console.error("[04_05_apps/mcp] GET /mcp failed:", error);
      return c.json(jsonRpcError("Internal server error", -32603), 500);
    }
  });

  app.delete("/", async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const sessionId = c.req.header(MCP_SESSION_HEADER);

    if (!sessionId) {
      return c.json(jsonRpcError("Method not allowed - no session"), 405);
    }

    try {
      console.log(`[04_05_apps/mcp] DELETE session=${sessionId}`);
      const session = await sessionStore.get(sessionId);
      if (!session) {
        const staleConnection = connections.get(sessionId);
        connections.delete(sessionId);
        closeTransport(staleConnection?.transport);
        void staleConnection?.server.close();
        return c.text("Invalid session", 404);
      }

      const connection = connections.get(sessionId);
      if (!connection) {
        return c.text("Invalid session", 404);
      }

      await connection.transport.handleRequest(req, res);

      connections.delete(sessionId);
      closeTransport(connection.transport);
      await connection.server.close();
      await sessionStore.delete(sessionId);

      return toFetchResponse(res);
    } catch (error) {
      console.error("[04_05_apps/mcp] DELETE /mcp failed:", error);
      return c.json(jsonRpcError("Internal server error", -32603), 500);
    }
  });

  return app;
};
