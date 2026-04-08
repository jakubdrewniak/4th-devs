import {
  AI_API_KEY,
  RESPONSES_API_ENDPOINT,
  EXTRA_API_HEADERS,
  buildResponsesRequest,
} from "../../../config.js";
import { MODEL } from "../config/defaults.js";
import { recordTrace } from "./trace.js";

export const complete = async (
  systemPrompt,
  userMessage,
  { model = MODEL, reasoning, temperature = null, jsonSchema, stage = "unknown" } = {},
) => {
  const body = buildResponsesRequest({
    model,
    ...(reasoning && { reasoning }),
    instructions: systemPrompt,
    input: userMessage,
    ...(temperature !== null && temperature !== undefined ? { temperature } : {}),
    ...(jsonSchema && {
      text: {
        format: {
          type: "json_schema",
          name: jsonSchema.name,
          schema: jsonSchema.schema,
          strict: false,
        },
      },
    }),
  });

  const t0 = performance.now();

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API ${response.status}: ${text}`);
  }

  const data = await response.json();
  const durationMs = Math.round(performance.now() - t0);
  const text = data.output?.flatMap((block) => block.content?.map((content) => content.text) ?? []).join("") ?? "";

  recordTrace({
    stage,
    request: { model, instructions: systemPrompt, input: userMessage, ...(jsonSchema ? { schema: jsonSchema.name } : {}) },
    response: { text, usage: data.usage ?? null },
    durationMs,
  });

  return text;
};
