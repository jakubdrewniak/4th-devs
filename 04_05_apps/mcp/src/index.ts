import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

import { config } from "./config/env.js";
import { buildHttpApp } from "./http/app.js";

let server: ServerType | null = null;
let sessionStoreCleanup: (() => void) | null = null;

const main = async (): Promise<void> => {
  try {
    const { app, sessionStore } = buildHttpApp();
    server = serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    });
    sessionStoreCleanup = () => {
      sessionStore.stopCleanup();
    };

    console.log(`04_05_apps MCP running at http://${config.host}:${config.port}/mcp`);
  } catch (error) {
    console.error("Failed to start 04_05_apps MCP.");
    console.error(error);
    process.exitCode = 1;
  }
};

const gracefulShutdown = (): void => {
  sessionStoreCleanup?.();
  server?.close();
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

void main();
