import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callMcpTool, listMcpTools } from '../mcp.js';
import type { ToolRegistry } from './types.js';

const ALLOWED_MCP_TOOLS = new Set(['fs_read', 'fs_search', 'fs_write']);

export const createMcpFileTools = async (client: Client): Promise<ToolRegistry> => {
  const serverTools = await listMcpTools(client);
  const tools: ToolRegistry = {};

  for (const tool of serverTools) {
    if (!ALLOWED_MCP_TOOLS.has(tool.name)) continue;

    tools[tool.name] = {
      description: tool.description ?? '',
      parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      handler: async (input) => {
        const result = await callMcpTool(client, tool.name, input);
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      },
    };
  }

  return tools;
};
