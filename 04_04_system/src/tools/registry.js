/*
  Tool registry — collects all available tools into a single place.

  Local tools (like sum) live here permanently.
  MCP tools are added dynamically at startup via `registerMcpTools()`.

  The agent calls `findHandler(name)` — it returns a function regardless
  of whether the tool is local or MCP-backed.

  `tools(names)` filters by name. MCP tools match by server prefix:
  "files" matches "files__fs_read", "files__fs_write", etc.
*/

import * as sum from "./sum.js";
import * as sendEmail from "./send-email.js";
import { callTool, toDefinitions } from "../mcp.js";

const localTools = [sum, sendEmail];

const handlers = Object.fromEntries(
  localTools.map((tool) => [tool.definition.name, tool.handler]),
);

let allDefinitions = localTools.map((tool) => tool.definition);

/* Add MCP tools to the registry. Called once after MCP connection. */
export const registerMcpTools = (mcpTools, mcpClients) => {
  const mcpDefinitions = toDefinitions(mcpTools);

  for (const tool of mcpTools) {
    handlers[tool.name] = (args) => callTool(mcpClients, tool.name, args);
  }

  allDefinitions = [...localTools.map((t) => t.definition), ...mcpDefinitions];
};

export const findHandler = (name) => handlers[name];

/*
  Return tool definitions, optionally filtered by name list.
  Local tools match exactly ("sum"). MCP tools match by server prefix
  ("files" matches all "files__*" tools).
*/
export const tools = (names) => {
  if (!names || names.length === 0) return allDefinitions;

  const nameSet = new Set(names);
  return allDefinitions.filter((def) =>
    nameSet.has(def.name) || nameSet.has(def.name.split("__")[0]),
  );
};
