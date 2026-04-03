import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_PROVIDER,
  AI_API_KEY,
  RESPONSES_API_ENDPOINT,
  EXTRA_API_HEADERS,
  resolveModelForProvider,
} from "../../config.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SRC_DIR, "..");

const loadLocalEnv = (file) => {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
};

loadLocalEnv(join(PROJECT_ROOT, ".env"));

const parsePort = (value, fallback) => {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

const defaultMcpHost = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
const defaultMcpPort = parsePort(process.env.MCP_HTTP_PORT, 4410);

export const appConfig = {
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: parsePort(process.env.PORT, 4406),
  mcpServerUrl: process.env.MCP_SERVER_URL?.trim() || `http://${defaultMcpHost}:${defaultMcpPort}/mcp`,
  model: process.env.OPENAI_MODEL?.trim() || "gpt-5.2",
  aiProvider: AI_PROVIDER,
  apiKey: AI_API_KEY,
  endpoint: RESPONSES_API_ENDPOINT,
  extraHeaders: EXTRA_API_HEADERS,
};

export const hasAiAccess = () => Boolean(appConfig.apiKey);

export const resolveModel = (model = appConfig.model) => {
  const normalized = String(model ?? "").trim();
  if (!normalized) return appConfig.model;
  return resolveModelForProvider(normalized);
};
