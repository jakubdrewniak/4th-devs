import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type Todo,
  CreateTodoInputSchema,
  GetTodoInputSchema,
  ListTodosInputSchema,
  UpdateTodoInputSchema,
  DeleteTodoInputSchema,
} from "../src/schemas.js";

const todos: Map<string, Todo> = new Map();

const server = new McpServer({
  name: "todo",
  version: "1.0.0",
});

server.tool(
  "create",
  "Create a new todo item",
  { title: CreateTodoInputSchema.shape.title },
  async ({ title }) => {
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    todos.set(todo.id, todo);
    return { content: [{ type: "text", text: JSON.stringify({ todo }) }] };
  }
);

server.tool(
  "get",
  "Get a todo by ID",
  { id: GetTodoInputSchema.shape.id },
  async ({ id }) => {
    const todo = todos.get(id);
    if (!todo) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify({ todo }) }] };
  }
);

server.tool(
  "list",
  "List todos, optionally filtered by status",
  { completed: ListTodosInputSchema.shape.completed },
  async ({ completed }) => {
    let result = Array.from(todos.values());
    if (completed !== undefined) {
      result = result.filter((t) => t.completed === completed);
    }
    return { content: [{ type: "text", text: JSON.stringify({ todos: result }) }] };
  }
);

server.tool(
  "update",
  "Update a todo",
  {
    id: UpdateTodoInputSchema.shape.id,
    title: UpdateTodoInputSchema.shape.title,
    completed: UpdateTodoInputSchema.shape.completed,
  },
  async ({ id, title, completed }) => {
    const todo = todos.get(id);
    if (!todo) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };
    }
    if (title !== undefined) todo.title = title;
    if (completed !== undefined) todo.completed = completed;
    todo.updatedAt = new Date().toISOString();
    return { content: [{ type: "text", text: JSON.stringify({ todo }) }] };
  }
);

server.tool(
  "delete",
  "Delete a todo",
  { id: DeleteTodoInputSchema.shape.id },
  async ({ id }) => {
    const existed = todos.delete(id);
    return { content: [{ type: "text", text: JSON.stringify({ success: existed }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
