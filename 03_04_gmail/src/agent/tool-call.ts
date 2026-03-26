import { z } from 'zod';
import type { Tool } from '../core/completion.js';
import { buildErrorHint, withHint } from '../hints/index.js';
import type { ToolDefinition } from '../types.js';
import type { AgentModelToolCall, AgentToolTrace } from './types.js';

const INVALID_JSON_ARGUMENTS_ERROR = 'Error: invalid JSON arguments';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ToolCallExecution {
  trace: AgentToolTrace;
  functionOutput: string;
}

export const asResponseTools = (definitions: ToolDefinition[]): Tool[] =>
  definitions.map((tool) => {
    const { $schema: _, ...parameters } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters,
      strict: null,
    };
  });

export const createToolRegistry = (
  definitions: ToolDefinition[],
): Map<string, ToolDefinition> => new Map(definitions.map((tool) => [tool.name, tool]));

const createToolTrace = (
  turn: number,
  call: AgentModelToolCall,
  parsedArguments: Record<string, unknown> | null,
  details: { output?: unknown; error?: string } = {},
): AgentToolTrace => ({
  turn,
  name: call.name,
  callId: call.call_id,
  rawArguments: call.arguments,
  parsedArguments,
  ...(typeof details.output !== 'undefined' ? { output: details.output } : {}),
  ...(typeof details.error === 'string' ? { error: details.error } : {}),
});

const parseJson = (raw: string): Result<Record<string, unknown>> => {
  try {
    return { ok: true, value: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { ok: false, error: INVALID_JSON_ARGUMENTS_ERROR };
  }
};

const validateSchema = (schema: z.ZodType, data: unknown): Result<unknown> => {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };

  const message = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
  return { ok: false, error: message };
};

const runHandler = async (
  tool: ToolDefinition,
  args: unknown,
): Promise<Result<unknown>> => {
  try {
    return { ok: true, value: await tool.handler(args) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

const toErrorOutput = (
  message: string,
  scope: 'tool' | 'global' = 'global',
): string => JSON.stringify(withHint(null, buildErrorHint(message, scope)));

export const executeToolCall = async (
  turn: number,
  call: AgentModelToolCall,
  toolRegistry: Map<string, ToolDefinition>,
): Promise<ToolCallExecution> => {
  const tool = toolRegistry.get(call.name);
  if (!tool) {
    const error = `Unknown tool: ${call.name}`;
    return {
      trace: createToolTrace(turn, call, null, { error }),
      functionOutput: toErrorOutput(error, 'global'),
    };
  }

  const json = parseJson(call.arguments);
  if (!json.ok) {
    return {
      trace: createToolTrace(turn, call, null, { error: json.error }),
      functionOutput: toErrorOutput(json.error, 'global'),
    };
  }

  const validated = validateSchema(tool.schema, json.value);
  if (!validated.ok) {
    return {
      trace: createToolTrace(turn, call, json.value, { error: validated.error }),
      functionOutput: toErrorOutput(validated.error, 'tool'),
    };
  }

  const execution = await runHandler(tool, validated.value);
  if (!execution.ok) {
    return {
      trace: createToolTrace(turn, call, validated.value as Record<string, unknown>, { error: execution.error }),
      functionOutput: toErrorOutput(execution.error, 'tool'),
    };
  }

  return {
    trace: createToolTrace(turn, call, validated.value as Record<string, unknown>, { output: execution.value }),
    functionOutput: JSON.stringify(execution.value),
  };
};
