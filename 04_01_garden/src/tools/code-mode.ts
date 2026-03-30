import { WORKDIR } from "../sandbox/client";
import type { Tool, ToolExecutionResult } from "../types";
import { join } from "node:path";

const RESULT_MARKER = "__CODE_MODE_RESULT__=";
const ERROR_MARKER = "__CODE_MODE_ERROR__=";
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 300;
const PROJECT_ROOT = join(import.meta.dir, "../..");

async function resolveScript(args: Record<string, unknown>): Promise<string> {
  const inline = typeof args.script === "string" && args.script.trim() ? args.script : undefined;
  const scriptPath = typeof args.script_path === "string" && args.script_path.trim() ? args.script_path.trim() : undefined;

  if (inline && scriptPath) throw new Error('Provide either "script" or "script_path", not both.');
  if (!inline && !scriptPath) throw new Error('One of "script" or "script_path" is required.');

  if (inline) return inline;

  const file = Bun.file(join(PROJECT_ROOT, scriptPath!));
  if (!(await file.exists())) throw new Error(`script_path not found: ${scriptPath}`);
  return file.text();
}

function buildRunner(userScript: string): string {
  return `// @ts-nocheck
import { readdir, mkdir, rename, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const WORKDIR = ${JSON.stringify(WORKDIR)};
const RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)};
const ERROR_MARKER = ${JSON.stringify(ERROR_MARKER)};
const execFileAsync = promisify(execFile);
const toAbs = (rel) => join(WORKDIR, rel);

const parseInput = () => {
  try { return JSON.parse(process.env.CODE_MODE_INPUT ?? "{}"); } catch { return {}; }
};

const codemode = {
  vault: {
    read: (path) => readFile(toAbs(path), "utf-8"),
    write: async (path, content) => {
      const abs = toAbs(path);
      await mkdir(dirname(abs), { recursive: true });
      const text = typeof content === "string" ? content : String(content);
      await writeFile(abs, text, "utf-8");
      return { path, bytes_written: Buffer.byteLength(text, "utf-8") };
    },
    list: async (path) => {
      const entries = await readdir(toAbs(path), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, is_dir: e.isDirectory() }));
    },
    search: async (path, pattern, maxResults = 200) => {
      const matches = [];
      const visit = async (absPath, relPath) => {
        if (matches.length >= maxResults) return;
        let entries;
        try { entries = await readdir(absPath, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          const childRel = relPath + "/" + entry.name;
          const childAbs = join(absPath, entry.name);
          if (entry.isDirectory()) { await visit(childAbs, childRel); continue; }
          let text;
          try { text = await readFile(childAbs, "utf-8"); } catch { continue; }
          const lines = text.split("\\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) matches.push({ path: childRel, line: i + 1, content: lines[i] });
            if (matches.length >= maxResults) break;
          }
        }
      };
      await visit(toAbs(path), path);
      return matches;
    },
    move: async (from, to) => {
      await mkdir(dirname(toAbs(to)), { recursive: true });
      await rename(toAbs(from), toAbs(to));
      return { from, to };
    },
  },
  runtime: {
    exec: async (command) => {
      let stdout = ""; let stderr = ""; let exitCode = 0;
      try {
        const r = await execFileAsync("sh", ["-lc", command], { cwd: WORKDIR, maxBuffer: 2 * 1024 * 1024 });
        stdout = (r.stdout ?? "").toString(); stderr = (r.stderr ?? "").toString();
      } catch (e) {
        stdout = (e.stdout ?? "").toString(); stderr = (e.stderr ?? "").toString();
        exitCode = typeof e.code === "number" ? e.code : 1;
      }
      return { exit_code: exitCode, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
    },
  },
  output: {
    _value: undefined,
    set(v) { this._value = v; },
    get() { return this._value; },
  },
};

const input = parseInput();

const userMain = async ({ input, codemode }) => {
${userScript}
};

(async () => {
  try {
    const returned = await userMain({ input, codemode });
    const result = codemode.output.get() ?? returned ?? { status: "completed" };
    console.log(RESULT_MARKER + JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.log(ERROR_MARKER + JSON.stringify({ message, stack }));
    process.exitCode = 1;
  }
})();
`;
}

function parseOutput(raw: string): { ok: boolean; result?: unknown; error?: string; logs: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const logs = lines
    .filter((l) => !l.startsWith(RESULT_MARKER) && !l.startsWith(ERROR_MARKER))
    .join("\n")
    .trim();

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(ERROR_MARKER)) {
      const payload = JSON.parse(lines[i].slice(ERROR_MARKER.length)) as { message?: string };
      return { ok: false, error: payload.message ?? "Script failed", logs };
    }
    if (lines[i].startsWith(RESULT_MARKER)) {
      const result = JSON.parse(lines[i].slice(RESULT_MARKER.length));
      return { ok: true, result, logs };
    }
  }

  return { ok: false, error: "No result marker in output", logs };
}

export const codeModeTool: Tool = {
  definition: {
    type: "function",
    name: "code_mode",
    description:
      "Execute TypeScript in the Daytona sandbox. Provide inline script or script_path to a skill script. " +
      "The script receives `input` (JSON) and `codemode` helpers (vault.read/write/list/search/move, runtime.exec, output.set).",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Inline TypeScript function body." },
        script_path: { type: "string", description: "Path to skill script under vault/system/skills/**/scripts/*." },
        input: { type: "object", description: "JSON passed to the script as `input`.", additionalProperties: true },
        timeout_seconds: { type: "integer", description: `Timeout in seconds (1-${MAX_TIMEOUT}).` },
      },
      additionalProperties: false,
    },
  },

  handler: async (rawArgs, context): Promise<ToolExecutionResult> => {
    try {
      const args = rawArgs as Record<string, unknown>;
      const script = await resolveScript(args);
      const timeout = typeof args.timeout_seconds === "number"
        ? Math.max(1, Math.min(args.timeout_seconds, MAX_TIMEOUT))
        : DEFAULT_TIMEOUT;

      const sandbox = await context.sandbox.get();
      const execution = await sandbox.process.codeRun(
        buildRunner(script),
        { env: { CODE_MODE_INPUT: JSON.stringify(args.input ?? {}) } },
        timeout,
      );

      const parsed = parseOutput(execution.result ?? "");
      return {
        ok: parsed.ok,
        output: JSON.stringify({
          ok: parsed.ok,
          ...(parsed.result !== undefined ? { result: parsed.result } : {}),
          ...(parsed.error ? { error: parsed.error } : {}),
          logs: parsed.logs,
          exit_code: execution.exitCode,
        }, null, 2),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output: JSON.stringify({ ok: false, error: message }, null, 2),
      };
    }
  },
};
