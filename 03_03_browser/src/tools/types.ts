export interface ImageContent {
  type: 'input_image';
  image_url: string;
  detail: 'low' | 'high' | 'auto';
}

export type ToolOutput = string | ImageContent[];

export interface ToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolOutput>;
}

export type ToolRegistry = Record<string, ToolDefinition>;
