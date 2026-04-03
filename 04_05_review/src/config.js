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

const DEFAULT_PORT = 4405;
const DEFAULT_MODEL = "gpt-5.4";

export const appConfig = {
  port: Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT,
  defaultModel: process.env.REVIEW_MODEL?.trim() || DEFAULT_MODEL,
  projectRoot: PROJECT_ROOT,
};

export const getApiConfig = () => ({
  provider: AI_PROVIDER,
  apiKey: AI_API_KEY,
  endpoint: RESPONSES_API_ENDPOINT,
  extraHeaders: EXTRA_API_HEADERS,
});

export const resolveModel = (model) => {
  const selected = model?.trim() || appConfig.defaultModel;
  return resolveModelForProvider(selected);
};
