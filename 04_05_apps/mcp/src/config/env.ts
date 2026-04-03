import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(SRC_DIR, "..", "..");
const APP_ROOT = resolve(MCP_ROOT, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");

const ENV_FILES = [
  join(REPO_ROOT, ".env"),
  join(APP_ROOT, ".env"),
  join(MCP_ROOT, ".env"),
];

const stripWrappingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value.at(-1);
  const isWrapped = (first === "\"" && last === "\"") || (first === "'" && last === "'");
  return isWrapped ? value.slice(1, -1) : value;
};

const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf-8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripWrappingQuotes(value.trim());
  }
};

for (const envFile of ENV_FILES) {
  loadEnvFile(envFile);
}

const parsePort = (value: unknown, fallback: number): number => {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

export const config = {
  host: process.env.MCP_HTTP_HOST?.trim() || process.env.HOST?.trim() || "127.0.0.1",
  port: parsePort(process.env.MCP_HTTP_PORT, 4410),
  serverName: process.env.MCP_SERVER_NAME?.trim() || "04_05_apps_mcp",
  serverVersion: process.env.MCP_SERVER_VERSION?.trim() || "0.1.0",
};
