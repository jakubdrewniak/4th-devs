/*
  LLM API client — handles communication with OpenAI / OpenRouter Responses API.

  This module is agent-unaware: it sends messages, tool definitions, and
  optional instructions. It knows nothing about the loop or agent identity.
*/

import {
  AI_API_KEY,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
} from "../../config.js";

const DEFAULT_MODEL = "gpt-5.2";

/* Send conversation + tool schemas to the Responses API */
export const complete = async (input, tools, { instructions, model } = {}) => {
  const body = buildResponsesRequest({
    model: resolveModelForProvider(model ?? DEFAULT_MODEL),
    input,
    tools,
    instructions,
  });

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data;
};
