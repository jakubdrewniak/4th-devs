import type { AnyTool, ResponseInput } from "../types";
import { config, openai, isOpenRouter, resolveModelForProvider } from "../config";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

interface CompletionParams {
  model: string;
  instructions: string;
  input: ResponseInput;
  tools: AnyTool[];
  previousResponseId?: string;
}

const ONLINE_SUFFIX = ":online";

function separateWebSearch(tools: AnyTool[]): {
  filtered: AnyTool[];
  hasWebSearch: boolean;
} {
  const filtered = tools.filter((t) => t.type !== "web_search");
  return { filtered, hasWebSearch: filtered.length < tools.length };
}

function createRequest(
  params: CompletionParams,
  effort: ReasoningEffort,
): ResponseCreateParamsNonStreaming {
  let model = resolveModelForProvider(params.model);
  let tools: AnyTool[] = params.tools;

  if (isOpenRouter) {
    const { filtered, hasWebSearch } = separateWebSearch(tools);
    tools = filtered;
    if (hasWebSearch && !model.endsWith(ONLINE_SUFFIX)) {
      model = `${model}${ONLINE_SUFFIX}`;
    }
  }

  const request: ResponseCreateParamsNonStreaming = {
    model,
    instructions: params.instructions,
    input: params.input,
    tools,
    reasoning: { effort },
  };

  if (!isOpenRouter) {
    request.previous_response_id = params.previousResponseId;
    request.include = ["web_search_call.action.sources"];
  }

  return request;
}

function shouldFallbackToHigh(error: unknown): boolean {
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status as number)
      : undefined;
  if (status !== 400) return false;

  const message = error instanceof Error ? error.message : String(error);
  return /(reasoning|effort|xhigh)/i.test(message);
}

export async function completion(params: CompletionParams): Promise<Response> {
  const request = createRequest(params, config.reasoningEffort);
  try {
    return await openai.responses.create(request);
  } catch (error) {
    if (config.reasoningEffort === "xhigh" && shouldFallbackToHigh(error)) {
      return openai.responses.create(createRequest(params, "high"));
    }
    throw error;
  }
}
