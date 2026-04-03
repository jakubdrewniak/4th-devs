import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { appConfig } from "./config.js";
import {
  acceptReviewComment,
  batchAcceptComments,
  batchRejectComments,
  convertToSuggestion,
  getDocumentMarkdown,
  rejectReviewComment,
  rerunReviewBlock,
  resolveReviewComment,
  revertReviewComment,
  runReview,
  updateBlock,
} from "./review-engine.js";
import {
  listDocuments,
  listPrompts,
  loadDocument,
  loadLatestReviewForDocument,
  hydrateReviewForDocument,
} from "./store.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(SRC_DIR, "../public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

const sendText = (response, statusCode, body, contentType) => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
};

const parseBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
};

const { existsSync } = await import("node:fs");

const tryServeStatic = async (pathname, response) => {
  const filePath = pathname === "/"
    ? join(PUBLIC_DIR, "index.html")
    : join(PUBLIC_DIR, pathname.slice(1));

  if (!existsSync(filePath)) return false;

  const isBinary = [".png", ".ico", ".woff", ".woff2"].includes(extname(filePath));
  const content = await readFile(filePath, isBinary ? undefined : "utf-8");
  const contentType = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
  const cacheControl = pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store";

  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
  response.end(content);
  return true;
};

const listen = (server, preferredPort) => new Promise((resolve, reject) => {
  const attempt = (port) => {
    const onError = (error) => {
      server.off("error", onError);

      if (error.code === "EADDRINUSE" && port === preferredPort) {
        attempt(0);
        return;
      }

      reject(error);
    };

    server.once("error", onError);
    server.listen(port, () => {
      server.off("error", onError);
      const address = server.address();

      resolve({
        server,
        port: typeof address === "object" && address ? address.port : preferredPort,
      });
    });
  };

  attempt(preferredPort);
});

export const startServer = async () => {
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (method === "GET" && !url.pathname.startsWith("/api")) {
        const served = await tryServeStatic(url.pathname, response);
        if (served) return;

        const fallback = await tryServeStatic("/", response);
        if (fallback) return;
      }

      if (method === "GET" && url.pathname === "/api/bootstrap") {
        const [documents, prompts] = await Promise.all([
          listDocuments(),
          listPrompts(),
        ]);
        sendJson(response, 200, { documents, prompts });
        return;
      }

      if (method === "GET" && url.pathname === "/api/document") {
        const path = url.searchParams.get("path");
        if (!path) throw new Error("Missing document path.");

        const [document, review] = await Promise.all([
          loadDocument(path),
          loadLatestReviewForDocument(path),
        ]);
        const hydrated = hydrateReviewForDocument(document, review);
        sendJson(response, 200, { document, review: hydrated });
        return;
      }

      if (method === "GET" && url.pathname === "/api/document/download") {
        const path = url.searchParams.get("path");
        if (!path) throw new Error("Missing document path.");

        const markdown = await getDocumentMarkdown(path);
        const filename = path.split("/").at(-1) ?? "document.md";

        response.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        });
        response.end(markdown);
        return;
      }

      if (method === "POST" && url.pathname === "/api/review") {
        const body = await parseBody(request);

        response.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "Transfer-Encoding": "chunked",
        });

        const sendEvent = (event) => {
          response.write(JSON.stringify(event) + "\n");
        };

        try {
          const result = await runReview({ ...body, onEvent: sendEvent });
          sendEvent({ type: "complete", document: result.document, review: result.review });
        } catch (error) {
          sendEvent({ type: "error", error: error.message });
        }

        response.end();
        return;
      }

      if (method === "POST" && url.pathname === "/api/review/block") {
        const body = await parseBody(request);
        const result = await rerunReviewBlock(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/document/save") {
        const body = await parseBody(request);
        const result = await updateBlock(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/accept") {
        const body = await parseBody(request);
        const result = await acceptReviewComment(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/reject") {
        const body = await parseBody(request);
        const result = await rejectReviewComment(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/resolve") {
        const body = await parseBody(request);
        const result = await resolveReviewComment(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/convert") {
        const body = await parseBody(request);
        const result = await convertToSuggestion(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/revert") {
        const body = await parseBody(request);
        const result = await revertReviewComment(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/accept-all") {
        const body = await parseBody(request);
        const result = await batchAcceptComments(body);
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/comments/reject-all") {
        const body = await parseBody(request);
        const result = await batchRejectComments(body);
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error.",
      });
    }
  });

  return listen(server, appConfig.port);
};
