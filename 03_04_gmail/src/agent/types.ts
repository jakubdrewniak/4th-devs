import type { InputItem } from '../core/completion.js';

export interface AgentSession {
  history: InputItem[];
}

export interface AgentToolTrace {
  turn: number;
  name: string;
  callId: string;
  rawArguments: string;
  parsedArguments: Record<string, unknown> | null;
  output?: unknown;
  error?: string;
}

export interface AgentEvalResult {
  finalText: string;
  turns: number;
  reachedMaxTurns: boolean;
  toolCalls: AgentToolTrace[];
}

export interface RunAgentParams {
  model: string;
  message: string;
  session?: AgentSession;
  maxTurns?: number;
  instructions?: string;
}

export interface AgentModelToolCall {
  name: string;
  call_id: string;
  arguments: string;
}

export const createSession = (): AgentSession => ({ history: [] });
