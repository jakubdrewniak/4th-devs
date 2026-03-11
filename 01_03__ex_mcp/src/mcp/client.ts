import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type McpClient = Client;
export type McpTool = Tool;

export const createMcpClient = async (server: McpServer): Promise<Client> => {
  const client = new Client(
    { name: "proxy-mcp-client", version: "1.0.0" },
    { capabilities: {} },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
};

export const listMcpTools = async (client: Client): Promise<Tool[]> => {
  const { tools } = await client.listTools();
  return tools;
};

export const callMcpTool = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const result = await client.callTool({ name, arguments: args });
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return result;
  try {
    return JSON.parse(textContent.text);
  } catch {
    return textContent.text;
  }
};

// Converts MCP tool schemas → OpenAI Chat Completions function-calling format
export const mcpToolsToOpenAI = (mcpTools: Tool[]) =>
  mcpTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
