import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ExecutionResult, PermissionLevel, SandboxOptions, ToolDefinition } from './types.js';

const WORKSPACE = join(process.cwd(), 'workspace');
const DENO_DIR = join(process.cwd(), '.cache', '03_02_code-deno');
const DEFAULT_TIMEOUT = 30_000;
const PDFKIT_SPECIFIER = 'npm:pdfkit';

/* ── Sandbox preparation ─────────────────────────────────────── */

const runDeno = async (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const proc = Bun.spawn(['deno', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DENO_DIR, DENO_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
};

const denoInstallHint = (): string => {
  const platform = process.platform;

  const lines = [
    '',
    '  ✖ Deno is not installed (required for the code sandbox)',
    '',
    '  Install Deno:',
  ];

  if (platform === 'darwin' || platform === 'linux') {
    lines.push('    curl -fsSL https://deno.land/install.sh | sh');
    if (platform === 'darwin') {
      lines.push('    # or: brew install deno');
    }
  } else if (platform === 'win32') {
    lines.push('    irm https://deno.land/install.ps1 | iex');
    lines.push('    # or: winget install DenoLand.Deno');
  } else {
    lines.push('    https://docs.deno.com/runtime/getting_started/installation/');
  }

  lines.push('', '  After installing, restart your terminal and re-run this example.', '');
  return lines.join('\n');
};

const ensureDeno = async (): Promise<string> => {
  try {
    const proc = Bun.spawn(['deno', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const version = await new Response(proc.stdout).text();
    await proc.exited;
    return version.split('\n')[0] ?? 'unknown';
  } catch {
    console.error(denoInstallHint());
    process.exit(1);
  }
};

const ensurePdfkitCached = async (): Promise<void> => {
  const nmFlag = '--node-modules-dir=auto';
  const cachedOnly = await runDeno(['cache', '--quiet', '--cached-only', nmFlag, PDFKIT_SPECIFIER]);
  if (cachedOnly.exitCode === 0) return;

  const result = await runDeno(['cache', '--quiet', nmFlag, PDFKIT_SPECIFIER]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'unknown error';
    throw new Error(`Unable to cache ${PDFKIT_SPECIFIER}: ${detail}`);
  }
};

export const ensureSandbox = async (): Promise<{ denoVersion: string }> => {
  const denoVersion = await ensureDeno();
  await ensurePdfkitCached();
  return { denoVersion };
};

/* ── Code execution ──────────────────────────────────────────── */

const buildPermissionFlags = (
  level: PermissionLevel,
  workspace: string,
  bridgePort?: number,
): string[] => {
  const base = ['--no-prompt'];
  const bridgeNet = bridgePort ? [`--allow-net=127.0.0.1:${bridgePort}`] : [];
  const readPaths = [workspace, DENO_DIR].join(',');
  const writePaths = [workspace, DENO_DIR].join(',');

  switch (level) {
    case 'safe':
      return [...base, ...bridgeNet];
    case 'standard':
      return [...base, `--allow-read=${readPaths}`, `--allow-write=${writePaths}`, ...bridgeNet];
    case 'network':
      return [...base, `--allow-read=${readPaths}`, `--allow-write=${writePaths}`, '--allow-net'];
    case 'full':
      return ['--allow-all'];
  }
};

export const executeCode = async (
  code: string,
  options: SandboxOptions = {},
): Promise<ExecutionResult> => {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const permissionLevel = options.permissionLevel ?? 'standard';
  const workspace = options.workspace ?? WORKSPACE;

  const fullCode = (options.prelude ?? '') + code;
  const tempDir = await mkdtemp(join(tmpdir(), 'deno-sandbox-'));
  const tempFile = join(tempDir, 'script.ts');
  await writeFile(tempFile, fullCode, 'utf-8');

  const flags = buildPermissionFlags(permissionLevel, workspace, options.bridgePort);

  try {
    const proc = Bun.spawn(['deno', 'run', '--node-modules-dir=auto', ...flags, tempFile], {
      cwd: workspace,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1', DENO_DIR },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timer);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, timedOut };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

/* ── Bridge (enables sandbox code → host tool calls via HTTP) ── */

export interface ToolBridge {
  port: number;
  stop: () => void;
}

export const startBridge = (tools: Record<string, ToolDefinition>): ToolBridge => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const name = new URL(req.url).pathname.slice(1);
      const tool = tools[name];
      if (!tool) return new Response(`Unknown tool: ${name}`, { status: 404 });

      try {
        const input = await req.json().catch(() => ({}));
        const result = await tool.handler(input as Record<string, unknown>);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(message, { status: 500 });
      }
    },
  });

  const { port } = server;
  if (typeof port !== 'number') {
    server.stop();
    throw new Error('Failed to bind bridge port.');
  }

  return { port, stop: () => server.stop() };
};

export const generatePrelude = (port: number, tools: Record<string, ToolDefinition>): string => {
  const methods = Object.keys(tools).map((name) => [
    `  async ${name}(input) {`,
    `    const res = await fetch("http://127.0.0.1:${port}/${name}", {`,
    `      method: "POST",`,
    `      headers: { "Content-Type": "application/json" },`,
    `      body: JSON.stringify(input ?? {})`,
    `    });`,
    `    if (!res.ok) throw new Error("Tool ${name} failed: " + await res.text());`,
    `    return res.json();`,
    `  }`,
  ].join('\n'));

  return `// Tool bridge — auto-generated\nconst tools = {\n${methods.join(',\n')}\n};\n\n`;
};
