import { executeAgent } from './runtime.js';
import type { AgentEvalResult, RunAgentParams } from './types.js';

export { createSession } from './types.js';
export type {
  AgentModelToolCall,
  AgentSession,
  AgentToolTrace,
  RunAgentParams,
} from './types.js';

export const runAgent = async (params: RunAgentParams): Promise<string> =>
  (await executeAgent(params)).finalText;

export const runAgentEval = async (params: RunAgentParams): Promise<AgentEvalResult> =>
  executeAgent(params);
