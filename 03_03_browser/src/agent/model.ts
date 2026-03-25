import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../../config.js';
import OpenAI from 'openai';
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import type { TokenUsage } from './types.js';
import type { ToolRegistry } from '../tools/index.js';

const DEFAULT_MODEL = resolveModelForProvider(process.env.MODEL ?? 'gpt-5.2');
export const MAX_TURNS = 30;

let _openai: OpenAI | null = null;
const openai = (): OpenAI => (_openai ??= new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS }));

export const buildFunctionTools = (tools: ToolRegistry): FunctionTool[] =>
  Object.entries(tools).map(([name, definition]) => ({
    type: 'function',
    name,
    description: definition.description,
    parameters: definition.parameters as Record<string, unknown>,
    strict: false,
  }));

export const createModelResponse = async (params: {
  instructions: string;
  input: string | ResponseInputItem[];
  tools: FunctionTool[];
  previousResponseId?: string;
}): Promise<Response> =>
  openai().responses.create({
    model: DEFAULT_MODEL,
    instructions: params.instructions,
    input: params.input,
    tools: params.tools,
    ...(params.previousResponseId ? { previous_response_id: params.previousResponseId } : {}),
  });

export const extractFunctionCalls = (output: Response['output']): ResponseFunctionToolCall[] =>
  output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');

export const extractTextOutput = (output: Response['output']): string =>
  output
    .filter((item): item is ResponseOutputMessage => item.type === 'message')
    .flatMap((msg) => msg.content)
    .filter((content) => content.type === 'output_text' && 'text' in content)
    .map((content) => (content as { text: string }).text)
    .join('\n');

export const applyUsage = (target: TokenUsage, usage: ResponseUsage | undefined): void => {
  if (!usage) return;

  target.input += usage.input_tokens;
  target.output += usage.output_tokens;
  target.cached += usage.input_tokens_details?.cached_tokens ?? 0;
  target.total += usage.total_tokens;
};
