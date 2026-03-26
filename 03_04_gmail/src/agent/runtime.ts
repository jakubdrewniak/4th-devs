import { complete, type InputItem } from '../core/completion.js';
import { buildSystemPrompt } from '../prompt.js';
import { tools } from '../tools/index.js';
import type { AgentEvalResult, AgentSession, AgentToolTrace, RunAgentParams } from './types.js';
import {
  asResponseTools,
  createToolRegistry,
  executeToolCall,
  type ToolCallExecution,
} from './tool-call.js';

const DEFAULT_MAX_TURNS = 8;
const FALLBACK_FINAL_TEXT = 'No response text returned.';
const MAX_TURN_FINAL_TEXT = 'Reached max turn limit before completion.';

interface RuntimeState {
  input: InputItem[];
  traces: AgentToolTrace[];
}

const createRuntimeState = (message: string, session?: AgentSession): RuntimeState => {
  const input = session ? session.history : [];
  input.push({ role: 'user', content: message });
  return { input, traces: [] };
};

const appendModelOutput = (state: RuntimeState, output: unknown[]): void => {
  state.input.push(...(output as InputItem[]));
};

const appendToolExecution = (
  state: RuntimeState,
  callId: string,
  execution: ToolCallExecution,
): void => {
  state.traces.push(execution.trace);
  state.input.push({
    type: 'function_call_output',
    call_id: callId,
    output: execution.functionOutput,
  });
};

const executeTurn = async (
  turn: number,
  params: {
    model: string;
    instructions: string;
    state: RuntimeState;
    responseTools: ReturnType<typeof asResponseTools>;
    toolRegistry: ReturnType<typeof createToolRegistry>;
  },
): Promise<{ done: true; finalText: string } | { done: false }> => {
  const result = await complete({
    model: params.model,
    instructions: params.instructions,
    input: params.state.input,
    tools: params.responseTools,
  });

  appendModelOutput(params.state, result.output);

  if (result.toolCalls.length === 0) {
    return {
      done: true,
      finalText: result.outputText ?? FALLBACK_FINAL_TEXT,
    };
  }

  for (const call of result.toolCalls) {
    const execution = await executeToolCall(turn, call, params.toolRegistry);
    appendToolExecution(params.state, call.call_id, execution);
  }

  return { done: false };
};

export const executeAgent = async (params: RunAgentParams): Promise<AgentEvalResult> => {
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  const instructions = params.instructions ?? buildSystemPrompt();
  const state = createRuntimeState(params.message, params.session);
  const responseTools = asResponseTools(tools);
  const toolRegistry = createToolRegistry(tools);

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const turnResult = await executeTurn(turn, {
      model: params.model,
      instructions,
      state,
      responseTools,
      toolRegistry,
    });

    if (turnResult.done) {
      return {
        finalText: turnResult.finalText,
        turns: turn,
        reachedMaxTurns: false,
        toolCalls: state.traces,
      };
    }
  }

  return {
    finalText: MAX_TURN_FINAL_TEXT,
    turns: maxTurns,
    reachedMaxTurns: true,
    toolCalls: state.traces,
  };
};
