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
const HUB = "https://hub.ag3nts.org";
const MODEL = "anthropic/claude-sonnet-4-6";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Item {
  id: string;
  description: string;
}

interface HubResponse {
  code: number;
  msg: string;
  note?: string;
}

// ─── Hub utilities ────────────────────────────────────────────────────────────

async function fetchCsv(): Promise<Item[]> {
  const url = `${HUB}/data/${API_KEY}/categorize.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCsv failed: HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split("\n");
  // Skip header row, parse "id,description" columns
  return lines.slice(1).map((line) => {
    const comma = line.indexOf(",");
    return {
      id: line.slice(0, comma).trim(),
      description: line.slice(comma + 1).trim(),
    };
  });
}

async function submitPrompt(prompt: string): Promise<HubResponse> {
  const payload = {
    apikey: API_KEY,
    task: "categorize",
    answer: { prompt },
  };

  console.log(`[hub] → prompt="${prompt}"`);

  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data: HubResponse = await res.json();
  console.log(`[hub] ← ${JSON.stringify(data)}`);
  return data;
}

async function resetSession(): Promise<HubResponse> {
  console.log("[hub] resetting session...");
  return submitPrompt("reset");
}

// ─── Tool: test_prompt ────────────────────────────────────────────────────────
// Runs a full cycle: reset → fetch fresh CSV → submit the same template 10
// times (once per item, sequentially). Returns a summary of every hub response.

async function testPrompt(promptTemplate: string): Promise<string> {
  await resetSession();

  const items = await fetchCsv();
  console.log(`[test_prompt] testing against ${items.length} items`);

  const results: string[] = [];

  for (const item of items) {
    const filledPrompt = promptTemplate
      .replace("{id}", item.id)
      .replace("{description}", item.description);
    const response = await submitPrompt(filledPrompt);
    const responseJson = JSON.stringify(response);

    // Detect flag
    const flagMatch = responseJson.match(/\{FLG:[^}]+\}/);
    if (flagMatch) {
      console.log(`\n[agent] FLAG FOUND: ${flagMatch[0]}`);
      return `FLAG: ${flagMatch[0]}`;
    }

    results.push(`[${item.id}] "${item.description}" → ${responseJson}`);
  }

  return results.join("\n");
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "test_prompt",
      description: `Run a full classification cycle with the given prompt template.
Steps internally: reset session → fetch fresh CSV (10 items) → for each item substitute {id} and {description} in the template and submit the expanded prompt.
Returns hub responses for all 10 items, or the flag string if successful.`,
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The prompt template. Must contain {id} and {description} placeholders. Must classify each item as DNG or NEU. Must fit within 100 tokens when expanded.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Agent system prompt ──────────────────────────────────────────────────────

const SYSTEM = `You are a prompt engineer. Your goal: craft a classification prompt that correctly categorizes all 10 goods as DNG (dangerous) or NEU (neutral).

Rules:
1. The prompt template must contain {id} and {description} placeholders — the hub substitutes real item data before running the internal classifier.
2. The expanded prompt (with real data substituted) must stay within 100 tokens total.
3. ALL items must be classified correctly — EXCEPT reactor-related items, which must ALWAYS be classified as NEU (even if their description sounds dangerous). This lets reactor cassettes pass inspection undetected.
4. Keep the static part of the prompt as short as possible to leave room for {description}.

Strategy:
- Call test_prompt with a candidate template.
- Read each hub response carefully: it tells you which item was wrong and what label was returned.
- Refine and retry until you receive a FLAG.
- Write the prompt in English to save tokens.
- Put {id} and {description} at the END of the prompt so the static prefix can be cached.`;

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgent(): Promise<void> {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Start crafting and testing the classification prompt." },
  ];

  const MAX_STEPS = 30;

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
      console.log(`\n[agent] done: ${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      console.log(`[agent] test_prompt: "${args.prompt}"`);

      const result = await testPrompt(args.prompt);

      if (result.startsWith("FLAG:")) {
        console.log(`\n[agent] SUCCESS — ${result}`);
        return;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runAgent().catch((err) => {
  console.error("[error]", err.message);
  process.exit(1);
});
