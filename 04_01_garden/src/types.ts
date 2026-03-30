import type OpenAI from "openai";
import type { LazySandbox } from "./sandbox/client";

export type ResponseInput = OpenAI.Responses.ResponseInput;
export type ResponseInputItem = OpenAI.Responses.ResponseInputItem;
export type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem;
export type ResponseFunctionToolCall = OpenAI.Responses.ResponseFunctionToolCall;
export type FunctionTool = OpenAI.Responses.FunctionTool;
export type WebSearchTool = OpenAI.Responses.WebSearchTool;
export type AnyTool = OpenAI.Responses.Tool;

export interface ToolContext {
  sandbox: LazySandbox;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string;
}

export interface Tool {
  definition: FunctionTool;
  handler: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolExecutionResult>;
}
