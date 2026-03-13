import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// ─── Load .env from project root ─────────────────────────────────────────────

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY = process.env.AI_DEVS_KEY!;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;
const ENDPOINT = "https://hub.ag3nts.org/verify";
const MODEL = "openai/gpt-4.1-mini";

// ─── HTTP Decorators ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 5,
  baseDelayMs: number = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isLastAttempt = attempt === retries;
      if (err?.status !== 503 || isLastAttempt) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(
        `[retry] 503 received, waiting ${delay}ms (attempt ${attempt + 1}/${retries})`,
      );
      await sleep(delay);
    }
  }
  throw new Error("withRetry: unreachable");
}

async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.status !== 429) throw err;

      const waitMs: number = err.retryAfterMs ?? 30_000;
      console.log(`[rate-limit] 429 received, waiting ${waitMs}ms until reset`);
      await sleep(waitMs);
    }
  }
}

async function apiCall(answer: Record<string, unknown>): Promise<unknown> {
  const payload = {
    apikey: API_KEY,
    task: "railway",
    answer,
  };

  return withRateLimit(() =>
    withRetry(async () => {
      console.log(`[railway] →  ${JSON.stringify(payload, null, 2)}`);

      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log(
        `[railway] ←  status=${response.status}`,
        JSON.stringify(data, null, 2),
      );

      if (response.status === 503) {
        const err: any = new Error("503 Service Unavailable");
        err.status = 503;
        throw err;
      }

      if (response.status === 429) {
        const retryAfterHeader =
          response.headers.get("retry-after") ??
          response.headers.get("x-ratelimit-reset");
        const retryAfterBody = (data as any)?.retry_after;
        const retryAfterSec = retryAfterHeader
          ? Number(retryAfterHeader)
          : retryAfterBody;
        const err: any = new Error("429 Rate Limited");
        err.status = 429;
        err.retryAfterMs = retryAfterSec ? retryAfterSec * 1000 : 30_000;
        throw err;
      }

      return data;
    }),
  );
}

// ─── Tool definition for LLM ─────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "railway_api",
      description: `Call the railway API. Pass the full "answer" object exactly as the API expects it.
Always start with { action: "help" } to discover required fields for each action.
Then include ALL required fields at the top level of the answer object.
Examples:
  { "action": "reconfigure", "route": "x-01" }
  { "action": "setstatus", "route": "x-01", "value": "RTOPEN" }
  { "action": "save", "route": "x-01" }`,
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "object",
            description: "The answer object to send to the API. Must include 'action' and all required fields for that action.",
            properties: {
              action: { type: "string", description: "The action name." },
              route: { type: "string", description: "Required for most actions. Use 'x-01'." },
              value: { type: "string", description: "Required for setstatus. Use 'RTOPEN' to open the route." },
            },
            required: ["action"],
            additionalProperties: false,
          },
        },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Agent loop ───────────────────────────────────────────────────────────────

const SYSTEM = `You are an agent that controls a railway API.

Your goal: activate route "x-01" (open it) using the API.

Instructions:
1. Start by calling action "help" to discover available actions and their required parameters.
2. For every action that has a non-empty "requires" list, you MUST include ALL required fields in the params object.
   - The route you are working with is always "x-01" — always pass { route: "x-01" } for actions that require it.
   - For setstatus also pass { route: "x-01", value: "RTOPEN" }.
3. Follow the exact sequence described in the API documentation (check the "notes" field).
4. Stop when you receive a flag in the format {FLG:...} in any API response.

Important: the API may be slow or rate-limited — the tool handles retries automatically, just keep going.`;

async function runAgent(): Promise<void> {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Activate route X-01 and retrieve the flag." },
  ];

  const MAX_STEPS = 20;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] step ${step}/${MAX_STEPS}`);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error)
      throw new Error(data?.error?.message ?? `HTTP ${res.status}`);

    const msg = data.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`\n[agent] LLM finished: ${msg.content}`);
      return;
    }

    console.log(`[agent] LLM requested ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      const { answer } = args;

      console.log(`[agent] calling railway_api:`, JSON.stringify(answer));

      const result = await apiCall(answer);
      const resultStr = JSON.stringify(result);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultStr,
      });

      if (resultStr.match(/\{FLG:[^}]+\}/)) {
        const flag = resultStr.match(/\{FLG:[^}]+\}/)![0];
        console.log(`\n[agent] FLAG FOUND: ${flag}`);
        return;
      }
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runAgent().catch((err) => {
  console.error("[error]", err.message);
  process.exit(1);
});
