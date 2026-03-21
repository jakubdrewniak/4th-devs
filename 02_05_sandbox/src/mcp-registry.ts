import { callMCPTool } from "./mcp-client.js";
import type {
  CreateTodoInput,
  GetTodoInput,
  ListTodosInput,
  UpdateTodoInput,
  DeleteTodoInput,
  TodoResponse,
  TodoListResponse,
  DeleteResponse,
} from "./schemas.js";

interface ToolMeta {
  name: string;
  description: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  typescript: string; // TypeScript signature shown to the agent
  implementation: (input: unknown) => Promise<unknown>;
}

interface ServerMeta {
  name: string;
  description: string;
  tools: ToolMeta[];
}

// Registry mapping server names to metadata
const registry: Record<string, ServerMeta> = {
  todo: {
    name: "todo",
    description: "Todo management server for creating, retrieving, updating, and deleting todos",
    tools: [
      { name: "create", description: "Create a new todo item" },
      { name: "get", description: "Get a todo by ID" },
      { name: "list", description: "List all todos, optionally filtered by completion status" },
      { name: "update", description: "Update an existing todo item" },
      { name: "delete", description: "Delete a todo item by ID" },
    ],
  },
};

// Full tool definitions with TypeScript signatures and implementations
const toolDefinitions: Record<string, Record<string, ToolDefinition>> = {
  todo: {
    create: {
      name: "create",
      description: "Create a new todo item",
      typescript: `interface CreateInput { title: string; }
interface Todo { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string; }
interface TodoResponse { todo: Todo; }
/** Create a new todo item */
function create(input: CreateInput): Promise<TodoResponse>;`,
      implementation: async (input: unknown) => {
        return callMCPTool<TodoResponse>("todo__create", input as CreateTodoInput);
      },
    },
    get: {
      name: "get",
      description: "Get a todo by ID",
      typescript: `interface GetInput { id: string; }
interface Todo { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string; }
interface TodoResponse { todo: Todo; }
/** Get a todo by ID */
function get(input: GetInput): Promise<TodoResponse>;`,
      implementation: async (input: unknown) => {
        return callMCPTool<TodoResponse>("todo__get", input as GetTodoInput);
      },
    },
    list: {
      name: "list",
      description: "List all todos, optionally filtered by completion status",
      typescript: `interface ListInput { completed?: boolean; }
interface Todo { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string; }
interface TodoListResponse { todos: Todo[]; }
/** List all todos, optionally filtered by completion status */
function list(input?: ListInput): Promise<TodoListResponse>;`,
      implementation: async (input: unknown) => {
        return callMCPTool<TodoListResponse>("todo__list", (input || {}) as ListTodosInput);
      },
    },
    update: {
      name: "update",
      description: "Update an existing todo item",
      typescript: `interface UpdateInput { id: string; title?: string; completed?: boolean; }
interface Todo { id: string; title: string; completed: boolean; createdAt: string; updatedAt: string; }
interface TodoResponse { todo: Todo; }
/** Update an existing todo item */
function update(input: UpdateInput): Promise<TodoResponse>;`,
      implementation: async (input: unknown) => {
        return callMCPTool<TodoResponse>("todo__update", input as UpdateTodoInput);
      },
    },
    delete: {
      name: "delete",
      description: "Delete a todo item by ID",
      typescript: `interface DeleteInput { id: string; }
interface DeleteResponse { success: boolean; }
/** Delete a todo item by ID */
function delete(input: DeleteInput): Promise<DeleteResponse>;`,
      implementation: async (input: unknown) => {
        return callMCPTool<DeleteResponse>("todo__delete", input as DeleteTodoInput);
      },
    },
  },
};

// Session state: tracks which tools have been loaded
const loadedTools: Map<string, ToolDefinition> = new Map();

/**
 * List all available servers
 */
export function listServers(): Array<{ name: string; description: string }> {
  return Object.values(registry).map((server) => ({
    name: server.name,
    description: server.description,
  }));
}

/**
 * List tools for a specific server
 */
export function listTools(serverName: string): ToolMeta[] | null {
  const server = registry[serverName];
  if (!server) return null;
  return server.tools;
}

/**
 * Get the full schema (TypeScript definition) for a tool and mark it as loaded
 */
export function getToolSchema(
  serverName: string,
  toolName: string
): { typescript: string } | null {
  const server = toolDefinitions[serverName];
  if (!server) return null;

  const tool = server[toolName];
  if (!tool) return null;

  // Mark as loaded
  const key = `${serverName}__${toolName}`;
  loadedTools.set(key, tool);

  return { typescript: tool.typescript };
}

/**
 * Get all loaded tool implementations grouped by server
 */
export function getLoadedImplementations(): Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
> {
  const result: Record<string, Record<string, (input: unknown) => Promise<unknown>>> = {};

  for (const [key, tool] of loadedTools) {
    const [serverName, toolName] = key.split("__");
    if (!result[serverName]) {
      result[serverName] = {};
    }
    result[serverName][toolName] = tool.implementation;
  }

  return result;
}

/**
 * Build a TypeScript declaration string for all loaded tools
 */
export function getLoadedTypeScript(): string {
  const declarations: string[] = [];

  // Group tools by server
  const serverTools: Record<string, Array<{ name: string; typescript: string }>> = {};

  for (const [key, tool] of loadedTools) {
    const [serverName] = key.split("__");
    if (!serverTools[serverName]) {
      serverTools[serverName] = [];
    }
    serverTools[serverName].push({ name: tool.name, typescript: tool.typescript });
  }

  // Generate declarations for each server
  for (const [serverName, tools] of Object.entries(serverTools)) {
    const methodDeclarations = tools.map((tool) => {
      // Extract function signature from typescript string
      const lines = tool.typescript.split("\n");
      const functionLine = lines.find((line) => line.includes("function") && line.includes(tool.name));
      if (functionLine) {
        // Extract the parameter list and return type
        const match = functionLine.match(/function\s+\w+\(([^)]*)\):\s*(Promise<[^>]+>);/);
        if (match) {
          const params = match[1].trim();
          const returnType = match[2];
          return `  ${tool.name}(${params}): ${returnType};`;
        }
      }
      // Fallback: use a generic signature
      return `  ${tool.name}(input: unknown): Promise<unknown>;`;
    });

    declarations.push(`declare const ${serverName}: {`);
    declarations.push(...methodDeclarations);
    declarations.push(`};`);
    declarations.push("");
  }

  return declarations.join("\n");
}

/**
 * Reset loaded tools for a new session
 */
export function resetLoadedTools(): void {
  loadedTools.clear();
}
