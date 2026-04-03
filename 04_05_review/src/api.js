import { getApiConfig, resolveModel } from "./config.js";

const extractText = (response) => (
  response.output_text
  ?? response.output.find((item) => item.type === "message")?.content?.[0]?.text
  ?? ""
);

export const complete = async ({ input, tools = [], instructions = "", model }) => {
  const { apiKey, endpoint, extraHeaders } = getApiConfig();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: resolveModel(model),
      input,
      tools,
      instructions,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Responses request failed with ${response.status}.`);
  }

  const usage = data.usage ?? {};
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const total = usage.input_tokens ?? 0;
  if (total > 0) {
    const MIN_CACHEABLE = 1024;
    if (total < MIN_CACHEABLE) {
      console.log(`[cache] skip — ${total} input tokens (below ${MIN_CACHEABLE} minimum)`);
    } else {
      const pct = ((cached / total) * 100).toFixed(1);
      console.log(`[cache] ${cached}/${total} input tokens cached (${pct}%)`);
    }
  }

  return {
    raw: data,
    output: data.output ?? [],
    text: extractText(data),
  };
};
