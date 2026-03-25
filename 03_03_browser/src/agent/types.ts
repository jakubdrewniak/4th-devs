import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { ToolOutcome } from '../feedback/index.js';

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  total: number;
}

export interface AgentResult {
  response: string;
  turns: number;
  responseId: string;
  usage: TokenUsage;
}

export interface ExecutedToolCall {
  item: ResponseInputItem;
  outcome: ToolOutcome;
  recoveredAfterFailures: boolean;
}

export interface InterventionState {
  screenshotTipSent: boolean;
  discoveryTipSent: boolean;
}
