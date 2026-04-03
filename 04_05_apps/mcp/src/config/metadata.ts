/**
 * Centralized tool metadata for the MCP server.
 *
 * This file contains all tool definitions with rich, LLM-friendly descriptions.
 * Benefits:
 * - Single source of truth for tool metadata
 * - Easy to maintain and update descriptions
 * - Natural language optimized for LLM understanding
 * - Consistent structure across all tools
 */

export interface ToolMetadata {
  name: string;
  title: string;
  description: string;
}

export const toolsMetadata = {
  example_api: {
    name: 'example_api',
    title: 'Example API Tool',
    description: `Call an example external API endpoint and return the response.

This tool demonstrates best practices for:
- Making HTTP requests to external APIs
- Handling responses and errors gracefully
- Validating input parameters with Zod schemas
- Formatting output for LLM consumption

The tool can be customized for any REST API by modifying:
1. The API endpoint URL
2. Input schema validation rules
3. Response parsing and formatting logic
4. Error handling for specific API error codes`,
  },
} as const satisfies Record<string, ToolMetadata>;

/**
 * Type-safe helper to get metadata for a tool.
 * Usage: getToolMetadata('example_api')
 */
export function getToolMetadata(toolName: keyof typeof toolsMetadata): ToolMetadata {
  return toolsMetadata[toolName];
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): string[] {
  return Object.keys(toolsMetadata);
}

/**
 * Server-level metadata
 */
export const serverMetadata = {
  title: 'MCP Server Template',
  instructions:
    'Use the available tools to inspect resources, run API calls, and keep responses concise.',
} as const;
