import {
  AI_PROVIDER,
  AI_API_KEY,
  CHAT_API_BASE_URL,
  EXTRA_API_HEADERS,
  resolveModelForProvider,
} from "../config.js";

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
const VALID_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const requestedModel = process.env.PRIMITIVES_MODEL?.trim() || DEFAULT_MODEL;
const reasoningEffort = process.env.PRIMITIVES_REASONING_EFFORT?.trim() || "medium";

const isReasoningModel = (model) => {
  const base = model.includes("/") ? model.split("/").pop() : model;
  return /^o\d/i.test(base);
};

export const primitivesConfig = {
  provider: AI_PROVIDER,
  apiKey: AI_API_KEY,
  baseUrl: CHAT_API_BASE_URL,
  headers: EXTRA_API_HEADERS,
  requestedModel,
  model: resolveModelForProvider(requestedModel),
  supportsReasoning: isReasoningModel(requestedModel),
  maxOutputTokens: parsePositiveInt(
    process.env.PRIMITIVES_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  ),
  reasoning: {
    effort: VALID_REASONING_EFFORTS.has(reasoningEffort)
      ? reasoningEffort
      : "medium",
    summary: "auto",
  },
};
