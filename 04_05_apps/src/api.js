import { appConfig, hasAiAccess, resolveModel } from "./config.js";

const extractMessageText = (response) => {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const message = (response?.output ?? []).find((item) => item?.type === "message");
  const textPart = (message?.content ?? []).find((part) => part?.type === "output_text");
  return textPart?.text?.trim() ?? "";
};

export const extractToolCalls = (response) => (
  (response?.output ?? []).filter((item) => item?.type === "function_call")
);

export const extractText = (response) => extractMessageText(response);

export const complete = async ({
  input,
  tools = [],
  instructions = "",
  model = appConfig.model,
}) => {
  if (!hasAiAccess()) {
    throw new Error("AI provider is not configured.");
  }

  const response = await fetch(appConfig.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.apiKey}`,
      ...appConfig.extraHeaders,
    },
    body: JSON.stringify({
      model: resolveModel(model),
      input,
      tools,
      instructions,
      parallel_tool_calls: false,
    }),
  });

  const rawBody = await response.text();
  let data;

  try {
    data = JSON.parse(rawBody);
  } catch {
    const bodyPreview = rawBody.trim().slice(0, 240) || "Empty response body.";
    throw new Error(`Responses API returned non-JSON (${response.status}): ${bodyPreview}`);
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message ?? `Responses request failed (${response.status}).`);
  }

  return {
    raw: data,
    output: data.output ?? [],
    text: extractMessageText(data),
  };
};
