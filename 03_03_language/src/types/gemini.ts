export interface TextContent {
  type: 'text';
  text?: string;
}

export interface AudioContent {
  type: 'audio';
  data?: string;
  mime_type?: string;
}

export interface ThoughtContent {
  type: 'thought';
  signature?: string;
  summary?: TextContent[];
}

export interface FunctionCallContent {
  type: 'function_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface FunctionResultContent {
  type: 'function_result';
  call_id: string;
  name?: string;
  result: string | unknown;
  is_error?: boolean;
}

export interface UnknownContent {
  type: string;
  [key: string]: unknown;
}

export type OutputContent =
  | TextContent
  | AudioContent
  | ThoughtContent
  | FunctionCallContent
  | FunctionResultContent
  | UnknownContent;

export interface FunctionToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: unknown;
}

export interface InteractionRequest {
  model: string;
  input: unknown;
  previous_interaction_id?: string;
  system_instruction?: string;
  tools?: FunctionToolDef[];
  generation_config?: Record<string, unknown>;
  response_format?: unknown;
  response_modalities?: string[];
}

export interface Interaction {
  id: string;
  status: string;
  outputs?: OutputContent[];
  usage?: Record<string, unknown>;
}
