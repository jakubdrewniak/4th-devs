import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import {
  AI_API_KEY,
  CHAT_API_BASE_URL,
  EXTRA_API_HEADERS,
  resolveModelForProvider,
} from "../../config.js";

const reasoningEffort: Exclude<ReasoningEffort, null> = "xhigh";

export const openai = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: CHAT_API_BASE_URL,
  defaultHeaders: EXTRA_API_HEADERS,
});

export { resolveModelForProvider };

export const config = {
  maxTurns: 20,
  reasoningEffort,
} as const;
