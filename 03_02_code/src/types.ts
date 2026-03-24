export type PermissionLevel = 'safe' | 'standard' | 'network' | 'full';

export interface ToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface SandboxOptions {
  timeout?: number;
  permissionLevel?: PermissionLevel;
  workspace?: string;
  prelude?: string;
  bridgePort?: number;
}
