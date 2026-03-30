import type { AnyTool, ResponseInput } from "../types";
import { config, openai, resolveModelForProvider } from "../config";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseIncludable,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

interface CompletionParams {
  model: string;
  instructions: string;
  input: ResponseInput;
  tools: AnyTool[];
  previousResponseId?: string;
}

function createRequest(
  params: CompletionParams,
  effort: ReasoningEffort,
): ResponseCreateParamsNonStreaming {
  const include: ResponseIncludable[] = ["web_search_call.action.sources"];

  return {
    model: resolveModelForProvider(params.model),
    instructions: params.instructions,
    input: params.input,
    tools: params.tools,
    previous_response_id: params.previousResponseId,
    include,
    reasoning: { effort },
  };
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
