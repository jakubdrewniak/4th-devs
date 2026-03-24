import { createInterface } from 'node:readline/promises';
import { runAgent } from './agent.js';
import { createMcpTools, createCodeTool } from './tools.js';
import { createMcpClient } from './mcp.js';
import { ensureSandbox, startBridge, generatePrelude } from './sandbox.js';
import type { PermissionLevel } from './types.js';

const yellow = (t: string) => `\x1b[33m${t}\x1b[0m`;
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;
const cyan = (t: string) => `\x1b[36m${t}\x1b[0m`;

const confirmRun = async (): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(yellow('\n  ⚠  UWAGA: To demo wykonuje zapytania do API (LLM + generowanie kodu w sandboxie Deno).'));
    console.log(yellow('     Pojedyncze uruchomienie może zużyć znaczną liczbę tokenów i zająć kilka minut.\n'));
    console.log(dim('     Jeśli chcesz tylko podejrzeć wyniki, zajrzyj do folderu:'));
    console.log(cyan('     workspace/demo/\n'));
    const answer = await rl.question('  Czy chcesz kontynuować? Wpisz "yes" aby uruchomić: ');
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
};

const VALID_LEVELS: PermissionLevel[] = ['safe', 'standard', 'network', 'full'];

const main = async () => {
  const skipConfirm = process.argv.includes('--yes');
  if (!skipConfirm) {
    const confirmed = await confirmRun();
    if (!confirmed) {
      console.log(dim('\n  Anulowano. Podejrzyj wyniki w workspace/demo/\n'));
      return;
    }
  }

  const { denoVersion } = await ensureSandbox();

  const permissionLevel = (process.env.PERMISSION_LEVEL ?? 'standard') as PermissionLevel;
  if (!VALID_LEVELS.includes(permissionLevel)) {
    console.error(`Invalid PERMISSION_LEVEL "${permissionLevel}". Use: ${VALID_LEVELS.join(', ')}`);
    process.exit(1);
  }

  const task = process.argv.slice(2).join(' ') || `\
Create a 2026 enterprise cost report from raw data found somewhere in the workspace.
Output a styled PDF to deliverables/2026-cost-report.pdf`;

  const mcpHandle = await createMcpClient('files');
  try {
    const mcpTools = await createMcpTools(mcpHandle.client);
    const bridge = startBridge(mcpTools);
    const prelude = generatePrelude(bridge.port, mcpTools);

    const tools = {
      ...mcpTools,
      execute_code: createCodeTool({ permissionLevel, prelude, bridgePort: bridge.port }),
    };

    console.log('\n========================================');
    console.log('  03_02 Code Agent — Deno Sandbox');
    console.log(`  ${denoVersion}`);
    console.log(`  Permission: ${permissionLevel}`);
    console.log(`  Tools: ${Object.keys(tools).join(', ')}`);
    console.log('========================================\n');

    console.log(`  Task:\n`);
    for (const line of task.split('\n')) console.log(`  ${line}`);
    console.log();

    try {
      const result = await runAgent(task, { permissionLevel, tools });

      console.log('\n========================================');
      console.log('  Result');
      console.log('========================================\n');
      console.log(result.response);
      console.log(`\n  (${result.turns} turns)`);
    } finally {
      bridge.stop();
    }
  } finally {
    await mcpHandle.close();
  }
};

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
