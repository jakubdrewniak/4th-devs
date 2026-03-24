import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../../config.js';
import OpenAI from 'openai';
import type { Response, FunctionTool, ResponseInputItem, ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputItem } from 'openai/resources/responses/responses';

const openai = new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS });

export type InputItem = ResponseInputItem;
export type Tool = FunctionTool;

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
  raw: Response;
}

const extractText = (output: ResponseOutputItem[]): string | null => {
  for (const item of output) {
    if (item.type === 'message') {
      const msg = item as ResponseOutputMessage;
      for (const block of msg.content) {
        if (block.type === 'output_text') return block.text;
      }
    }
  }
  return null;
};

const extractToolCalls = (output: ResponseOutputItem[]): ResponseFunctionToolCall[] =>
  output.filter(
    (item): item is ResponseFunctionToolCall => item.type === 'function_call',
  );

export const complete = async (params: CompletionParams): Promise<CompletionResult> => {
  const response = await openai.responses.create({
    model: params.model,
    instructions: params.instructions,
    input: params.input,
    tools: params.tools,
    store: params.store ?? false,
  });

  return {
    outputText: extractText(response.output),
    toolCalls: extractToolCalls(response.output),
    output: response.output,
    usage: response.usage,
    raw: response,
  };
};
