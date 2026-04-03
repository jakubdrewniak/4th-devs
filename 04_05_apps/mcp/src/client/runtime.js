import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { isAppOnlyTool } from "../core/marketing-server.js";

const readTextContent = (result) => (
  (result?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim()
);

const safeClientCall = async (callback, fallback) => {
  try {
    return await callback();
  } catch {
    return fallback;
  }
};

const createClient = () => new Client(
  { name: "04_05_apps_remote_client", version: "0.1.0" },
  {
    capabilities: {
      extensions: {
        "io.modelcontextprotocol/ui": {
          mimeTypes: [RESOURCE_MIME_TYPE],
        },
      },
    },
  },
);

const closeConnection = async (connection) => {
  await connection.client.close().catch(() => {});
  await connection.transport.close().catch(() => {});
};

const createConnection = async (endpoint) => {
  const client = createClient();
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return { client, transport };
};

const shouldReconnect = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid session") || message.includes("Mcp-Session-Id required");
};

const createRuntimeFromClient = async ({
  client,
  close,
  withClient,
}) => {
  const listAllTools = async () => {
    const { tools } = await withClient((activeClient) => activeClient.listTools());
    return tools;
  };

  const tools = await listAllTools();
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    async listModelTools() {
      return (await listAllTools()).filter((tool) => !isAppOnlyTool(tool));
    },
    async listTools() {
      const { tools } = await withClient((activeClient) => activeClient.listTools());
      return { tools };
    },
    async listResources() {
      return safeClientCall(() => withClient((activeClient) => activeClient.listResources()), { resources: [] });
    },
    async listResourceTemplates() {
      return safeClientCall(() => withClient((activeClient) => activeClient.listResourceTemplates()), { resourceTemplates: [] });
    },
    async listPrompts() {
      return safeClientCall(() => withClient((activeClient) => activeClient.listPrompts()), { prompts: [] });
    },
    getToolMetadata(name) {
      return toolMap.get(name) ?? null;
    },
    async callTool(name, args = {}) {
      return withClient((activeClient) => activeClient.callTool({ name, arguments: args }));
    },
    async readResource(uri) {
      return withClient((activeClient) => activeClient.readResource({ uri }));
    },
    extractText(result) {
      return readTextContent(result);
    },
    close,
  };
};

export const createMcpRuntime = async ({ endpoint }) => {
  if (!endpoint) {
    throw new Error("Standalone MCP endpoint is required.");
  }

  let connection = await createConnection(endpoint);
  let reconnectPromise = null;

  const reconnect = async () => {
    if (reconnectPromise) {
      return reconnectPromise;
    }

    reconnectPromise = (async () => {
      const previousConnection = connection;
      await closeConnection(previousConnection);
      connection = await createConnection(endpoint);
      reconnectPromise = null;
      return connection;
    })().catch((error) => {
      reconnectPromise = null;
      throw error;
    });

    return reconnectPromise;
  };

  const withClient = async (callback) => {
    try {
      return await callback(connection.client);
    } catch (error) {
      if (!shouldReconnect(error)) {
        throw error;
      }

      const nextConnection = await reconnect();
      return callback(nextConnection.client);
    }
  };

  return createRuntimeFromClient({
    client: connection.client,
    withClient,
    close: async () => {
      if (reconnectPromise) {
        await reconnectPromise.catch(() => {});
      }

      await closeConnection(connection);
    },
  });
};
