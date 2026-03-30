import type { Tool, FunctionTool, AnyTool, WebSearchTool } from "../types";
import { terminalTool } from "./terminal";
import { codeModeTool } from "./code-mode";
import { gitPushTool } from "./git-push";

const registry = new Map<string, Tool>();

function register(tool: Tool) {
  registry.set(tool.definition.name, tool);
}

register(terminalTool);
register(codeModeTool);
register(gitPushTool);

const BUILTIN_TOOLS: Record<string, AnyTool> = {
  web_search: {
    type: "web_search",
    search_context_size: "medium",
  } satisfies WebSearchTool,
};

export function findTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function definitions(names?: string[]): AnyTool[] {
  if (!names) return [...registry.values()].map((t) => t.definition);
  return names
    .map((n) => BUILTIN_TOOLS[n] ?? registry.get(n)?.definition)
    .filter((d): d is AnyTool => d !== undefined);
}
