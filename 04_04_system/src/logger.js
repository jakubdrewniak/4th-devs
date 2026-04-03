import { mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "run.jsonl");

const supportsColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const colorize = (text, ...styles) => {
  if (!supportsColor) return text;
  return `${styles.map((s) => ansi[s]).join("")}${text}${ansi.reset}`;
};

const label = (name, color) => colorize(`[${name}]`, "bold", color);

const charCount = (value) => {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length;
};

const summarizeArgs = (name, args) => {
  if (name.endsWith("fs_read") && args.path) return args.path;
  if (name.endsWith("fs_write") && args.path) return `${args.path} (${charCount(args.content)} chars)`;
  if (name.endsWith("fs_search") && args.query) return `"${args.query}" in ${args.path ?? "workspace"}`;
  if (name.endsWith("fs_manage") && args.operation) return `${args.operation} ${args.path}`;
  if (name === "delegate") return `→ ${args.agent}: ${args.task?.slice(0, 80)}…`;
  if (name === "send_email") return `to:${args.to} subj:"${args.subject}"`;
  if (name.endsWith("search") && args.queries) return `"${args.queries}"`;
  return Object.entries(args).map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v)}`).join(" ");
};

const summarizeResult = (name, result) => {
  if (typeof result === "string") return `${result.length} chars`;
  if (result?.success === true && result?.type === "file") return `✓ ${result.path} (${result.content?.totalLines ?? "?"} lines)`;
  if (result?.success === true && result?.type === "directory") return `✓ ${result.summary}`;
  if (result?.status === "applied") return `✓ ${result.result?.action ?? "written"}`;
  if (result?.status) return result.status;
  if (result?.agent) return `${result.agent}: ${typeof result.result === "string" ? result.result.slice(0, 100) : "done"}`;
  return `${charCount(result)} chars`;
};

const writeLog = (entry) => {
  appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
};

export const initLogs = () => {
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
};

export const logQuestion = (text) => {
  console.log(`\n${label("USER", "blue")} ${text.length > 120 ? text.slice(0, 120) + "…" : text}\n`);
  writeLog({ type: "question", text });
};

export const logToolCall = (name, args, agent) => {
  const summary = summarizeArgs(name, args);
  console.log(`  ${label(agent ?? "TOOL", "magenta")} ${colorize(name, "cyan")} ${colorize(summary, "dim")}`);
  writeLog({ type: "tool_call", agent, name, args });
};

export const logToolResult = (name, result, agent) => {
  const summary = summarizeResult(name, result);
  console.log(`  ${colorize("→", "yellow")} ${colorize(summary, "dim")}`);
  writeLog({ type: "tool_result", agent, name, result });
};

export const logAnswer = (text, agent) => {
  console.log(`\n${label(agent ?? "ASSISTANT", "green")} ${text}\n`);
  writeLog({ type: "answer", agent, text });
};

export const logError = (message) => {
  console.error(`${label("ERROR", "red")} ${message}`);
  writeLog({ type: "error", message });
};
