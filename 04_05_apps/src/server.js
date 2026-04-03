import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runAgentTurn } from "./agent.js";
import { appConfig, hasAiAccess } from "./config.js";
import { createMcpRuntime } from "../mcp/src/client/runtime.js";
import { ensureTodoWorkspace, readTodosState, summarizeTodos } from "../mcp/src/store/todos.js";
import { summarizeProducts, summarizeSales } from "../mcp/src/store/stripe.js";
import { summarizeCampaigns } from "../mcp/src/store/newsletters.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SRC_DIR, "..");
const PUBLIC_DIR = join(PROJECT_ROOT, "public");
const INDEX_FILE = join(PUBLIC_DIR, "index.html");
const VENDOR_DIR = join(PUBLIC_DIR, "vendor");
const HOST_BRIDGE_ENTRY = join(PROJECT_ROOT, "src/vendor/ext-apps-bridge-entry.js");
const HOST_BRIDGE_BUNDLE = join(VENDOR_DIR, "ext-apps-bridge.bundle.js");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const json = (payload, status = 200) => Response.json(payload, {
  status,
  headers: {
    "Cache-Control": "no-store",
  },
});

const readBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const safeStaticPath = (root, pathname) => {
  const rootPath = resolve(root);
  const targetPath = resolve(root, `.${pathname}`);
  if (targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`)) {
    return targetPath;
  }
  return null;
};

const serveFile = async (absolutePath, cacheControl = "no-store") => new Response(
  await readFile(absolutePath),
  {
    headers: {
      "Content-Type": MIME_TYPES[extname(absolutePath)] ?? "application/octet-stream",
      "Cache-Control": cacheControl,
    },
  },
);

const tryServePublicFile = async (pathname) => {
  const filePath = pathname === "/" ? INDEX_FILE : safeStaticPath(PUBLIC_DIR, pathname);
  if (!filePath || !existsSync(filePath)) return null;
  const cacheControl = pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
  return serveFile(filePath, cacheControl);
};

const formatBuildLogs = (logs = []) => logs
  .map((log) => log?.message ?? String(log))
  .filter(Boolean)
  .join("\n");

const ensureVendorBundles = async () => {
  await mkdir(VENDOR_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [HOST_BRIDGE_ENTRY],
    target: "browser",
    format: "esm",
    packages: "bundle",
    sourcemap: "none",
    minify: false,
  });

  if (!result.success) {
    throw new Error(formatBuildLogs(result.logs) || "Failed to build MCP Apps host bridge bundle.");
  }

  if (!result.outputs?.[0]) {
    throw new Error("Bridge build succeeded without producing an output artifact.");
  }

  await Bun.write(HOST_BRIDGE_BUNDLE, result.outputs[0]);
};

export const startServer = async () => {
  await ensureTodoWorkspace();
  await ensureVendorBundles();
  let runtime;

  try {
    runtime = await createMcpRuntime({ endpoint: appConfig.mcpServerUrl });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to the remote MCP server at ${appConfig.mcpServerUrl}. Start the MCP server first with: npm run lesson20:apps:mcp\n\nOriginal error: ${reason}`,
    );
  }

  const server = Bun.serve({
    hostname: appConfig.host,
    port: appConfig.port,
    fetch: async (request) => {
      const url = new URL(request.url);

      try {
        if (request.method === "GET" && url.pathname === "/api/bootstrap") {
          const todos = await readTodosState();
          return json({
            mode: hasAiAccess() ? appConfig.aiProvider : "local-fallback",
            model: appConfig.model,
            mcpMode: "remote-http",
            todosSummary: summarizeTodos(todos),
            productsSummary: await summarizeProducts(),
            salesSummary: await summarizeSales(),
            campaignsSummary: await summarizeCampaigns(),
            suggestions: [
              { category: "Review", items: [
                "Show the Spring Launch campaign",
                "Compare Spring Launch vs February Product Update",
                "Open the newsletter dashboard",
              ]},
              { category: "Cross-domain", items: [
                "Review Spring Launch and show sales around its send date",
                "Check if the May Growth Promo has a coupon, if not create one",
                "Show the best performing campaign and create follow-up todos",
                "Compare all campaigns and show which coupon drove most revenue",
              ]},
              { category: "Analytics", items: [
                "Show sales for March only",
                "Show Growth plan sales for February",
                "Show active coupons and their redemption rates",
              ]},
              { category: "Actions", items: [
                "Create a 15% coupon for the Starter plan",
                "Open the coupon manager",
                "Add todo: draft the May newsletter",
                "Show my todos",
              ]},
            ],
          });
        }

        if (request.method === "POST" && url.pathname === "/api/chat") {
          const body = await readBody(request);
          const result = await runAgentTurn({
            message: body?.message,
            appContexts: body?.appContexts,
            runtime,
          });
          return json(result);
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/tools/list") {
          return json(await runtime.listTools());
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/tools/call") {
          const body = await readBody(request);
          if (typeof body?.name !== "string" || !body.name.trim()) {
            return json({ error: "Tool name is required." }, 400);
          }

          const result = await runtime.callTool(body.name, body.arguments ?? {});
          return json(result);
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/resources/read") {
          const body = await readBody(request);
          if (typeof body?.uri !== "string" || !body.uri.trim()) {
            return json({ error: "Resource URI is required." }, 400);
          }

          const result = await runtime.readResource(body.uri);
          return json(result);
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/resources/list") {
          return json(await runtime.listResources());
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/resources/templates/list") {
          return json(await runtime.listResourceTemplates());
        }

        if (request.method === "POST" && url.pathname === "/api/mcp/prompts/list") {
          return json(await runtime.listPrompts());
        }

        if (request.method === "GET") {
          return await tryServePublicFile(url.pathname) ?? await serveFile(INDEX_FILE);
        }

        return json({ error: "Not found." }, 404);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "Unknown server error.",
        }, 500);
      }
    },
  });

  const host = appConfig.host === "0.0.0.0" ? "127.0.0.1" : appConfig.host;

  return {
    url: `http://${host}:${server.port}`,
    async stop() {
      server.stop(true);
      await runtime.close();
    },
  };
};
