import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const servers: Map<string, Client> = new Map();

export async function connectServer(
  name: string,
  command: string,
  args: string[] = []
): Promise<void> {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: `client-${name}`, version: "1.0.0" }, {});
  await client.connect(transport);
  servers.set(name, client);
}

export async function callMCPTool<T>(
  toolName: string,
  input: Record<string, unknown>
): Promise<T> {
  const [serverName, tool] = toolName.split("__");
  const client = servers.get(serverName);
  if (!client) throw new Error(`MCP server '${serverName}' not connected`);

  const result = await client.callTool({ name: tool, arguments: input });
  if (result.isError) {
    throw new Error(`Tool error: ${JSON.stringify(result.content)}`);
  }

  const textContent = result.content.find((c: { type: string }) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("Unexpected response format");
  }

  return JSON.parse(textContent.text) as T;
}

export async function disconnectAll(): Promise<void> {
  for (const [, client] of servers) {
    await client.close();
  }
  servers.clear();
}
