import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { listMcpTools, callMcpTool } from './mcp.js';
import { executeCode } from './sandbox.js';
import type { ToolDefinition, SandboxOptions } from './types.js';

export const createMcpTools = async (client: Client): Promise<Record<string, ToolDefinition>> => {
  const serverTools = await listMcpTools(client);
  const tools: Record<string, ToolDefinition> = {};

  for (const tool of serverTools) {
    tools[tool.name] = {
      description: tool.description ?? '',
      parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      handler: async (input) => callMcpTool(client, tool.name, input),
    };
  }

  return tools;
};

export const createCodeTool = (options: SandboxOptions): ToolDefinition => ({
  description:
    'Execute TypeScript code in an isolated Deno sandbox. ' +
    'Top-level await supported. Use console.log() to return output. ' +
    'Has access to Deno APIs for file I/O and npm: specifiers (e.g. npm:pdfkit).',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'TypeScript code to execute in Deno' },
    },
    required: ['code'],
    additionalProperties: false,
  },
  handler: async (input) => {
    const code = typeof input.code === 'string' ? input.code : '';
    if (!code) return 'Error: Missing "code" string field.';

    console.log(`  ─────────────────────────────────`);
    for (const line of code.split('\n')) console.log(`  │ ${line}`);
    console.log(`  ─────────────────────────────────`);

    const result = await executeCode(code, options);

    if (result.timedOut) return 'Error: Execution timed out (30s limit)';
    if (result.exitCode !== 0) {
      let output = `Error (exit ${result.exitCode}):\n${result.stderr}`;
      if (result.stdout) output += `\n\nPartial output:\n${result.stdout}`;
      return output;
    }
    let output = result.stdout || '(executed successfully, no output)';
    if (result.stderr) output += `\n\n[stderr]: ${result.stderr}`;
    return output;
  },
});
