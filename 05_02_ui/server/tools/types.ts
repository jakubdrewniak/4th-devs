import type { ArtifactKind } from '../../shared/chat'

export interface ToolContext {
  dataDir: string
}

export interface FunctionToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolArtifact {
  kind: ArtifactKind
  title: string
  description?: string
  path: string
  preview: string
}

export interface ToolExecutionResult {
  output: unknown
  artifacts?: ToolArtifact[]
}

export interface RegisteredTool {
  definition: FunctionToolDefinition
  handle: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecutionResult>
}
