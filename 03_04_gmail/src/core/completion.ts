import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../../config.js';
import OpenAI from 'openai';
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseIncludable,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
} from 'openai/resources/responses/responses';

const openai = new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS });

export type InputItem = ResponseInputItem;
export type Tool = FunctionTool;

// Reasoning-capable models (gpt-5 family, o-series) emit reasoning items with
// server-side IDs. Without encrypted_content those IDs cannot be replayed in
// subsequent turns when store=false, causing 404 errors on turn 2+.
// Non-reasoning models (gpt-4.1, gpt-4o, etc.) reject these params entirely.
const REASONING_MODEL_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4'];

const isReasoningModel = (model: string): boolean =>
  REASONING_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

export interface CompletionParams {
  model: string;
  instructions: string;
  input: InputItem[];
  tools?: Tool[];
  store?: boolean;
}

export interface CompletionResult {
  outputText: string | null;
  toolCalls: ResponseFunctionToolCall[];
  output: ResponseOutputItem[];
  usage: Response['usage'];
}

const extractText = (output: ResponseOutputItem[]): string | null => {
  for (const item of output) {
    if (item.type !== 'message') continue;
    const message = item as ResponseOutputMessage;
    for (const block of message.content) {
      if (block.type === 'output_text') return block.text;
    }
  }
  return null;
};

const extractToolCalls = (output: ResponseOutputItem[]): ResponseFunctionToolCall[] =>
  output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');

export const complete = async (params: CompletionParams): Promise<CompletionResult> => {
  const reasoning = isReasoningModel(params.model);
  const response = await openai.responses.create({
    model: params.model,
    instructions: params.instructions,
    input: params.input,
    tools: params.tools,
    store: params.store ?? false,
    ...(reasoning ? { reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content' as ResponseIncludable] } : {}),
  });

  return {
    outputText: extractText(response.output),
    toolCalls: extractToolCalls(response.output),
    output: response.output,
    usage: response.usage,
  };
};
