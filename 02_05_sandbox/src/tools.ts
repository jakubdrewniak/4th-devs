import {
  listServers,
  listTools,
  getToolSchema,
  getLoadedImplementations,
  getLoadedTypeScript,
} from "./mcp-registry.js";
import { executeCode } from "./sandbox.js";

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const tools: Tool[] = [
  {
    definition: {
      type: "function",
      name: "list_servers",
      description: "List all available MCP servers",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const servers = listServers();
        return JSON.stringify(servers, null, 2);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    definition: {
      type: "function",
      name: "list_tools",
      description: "List all tools available from a specific MCP server",
      parameters: {
        type: "object",
        properties: {
          server: {
            type: "string",
            description: "The name of the MCP server",
          },
        },
        required: ["server"],
        additionalProperties: false,
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        if (typeof args.server !== "string") {
          return "Error: server parameter must be a string";
        }
        const toolList = listTools(args.server);
        if (!toolList) return `Error: Server "${args.server}" not found`;
        return JSON.stringify(toolList, null, 2);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    definition: {
      type: "function",
      name: "get_tool_schema",
      description: "Get the TypeScript schema for a specific tool from an MCP server",
      parameters: {
        type: "object",
        properties: {
          server: {
            type: "string",
            description: "The name of the MCP server",
          },
          tool: {
            type: "string",
            description: "The name of the tool",
          },
        },
        required: ["server", "tool"],
        additionalProperties: false,
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        if (typeof args.server !== "string") {
          return "Error: server parameter must be a string";
        }
        if (typeof args.tool !== "string") {
          return "Error: tool parameter must be a string";
        }
        const schema = getToolSchema(args.server, args.tool);
        if (!schema) return `Error: Tool "${args.tool}" not found in server "${args.server}"`;
        return `TypeScript definition loaded:\n\n${schema.typescript}\n\nYou can now use ${args.server}.${args.tool}() in execute_code.`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    definition: {
      type: "function",
      name: "execute_code",
      description: "Execute JavaScript code in an isolated QuickJS sandbox with access to loaded MCP tool APIs. Tool calls are SYNCHRONOUS (no async/await needed). Write top-level statements directly. Use console.log() to return output.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript code to execute",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        if (typeof args.code !== "string") {
          return "Error: code parameter must be a string";
        }
        const implementations = getLoadedImplementations();
        const typescript = getLoadedTypeScript();
        console.log("Loaded TypeScript APIs:\n\n", typescript);
        const result = await executeCode(args.code, implementations);
        if (result.error) {
          console.log(`[sandbox] Error: ${result.error}`);
          return `Error: ${result.error}\n\nLogs:\n${result.logs.join("\n")}`;
        }
        if (result.logs.length > 0) {
          console.log(`[sandbox] Output (${result.logs.length} lines):\n${result.logs.join("\n")}`);
        } else {
          console.log(`[sandbox] No output captured`);
        }
        return result.logs.join("\n") || "(executed successfully, no output)";
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
];

export const findTool = (name: string): Tool | undefined =>
  tools.find((t) => t.definition.name === name);
