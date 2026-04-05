// imports
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ─────────────────────────────────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ──────────────────────────────────────────────────────────────────
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) { console.error("[config] Missing AI_DEVS_KEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB = "https://hub.ag3nts.org";
const TASK = "foodwarehouse";
const FOOD4CITIES_URL = `${HUB}/dane/food4cities.json`;
const MODEL = "anthropic/claude-sonnet-4-6";
const MAX_STEPS = 60;

// ─── OpenAI client (OpenRouter) ───────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Tool implementations ─────────────────────────────────────────────────────

async function hubApi(answer: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  return res.json();
}

async function fetchFood4Cities(): Promise<unknown> {
  const res = await fetch(FOOD4CITIES_URL);
  if (!res.ok) throw new Error(`food4cities fetch failed: HTTP ${res.status}`);
  return res.json();
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "hub_api",
      description: `Calls the foodwarehouse API at ${HUB}/verify. Pass the full 'answer' object as you would send it to the API (without apikey/task — those are added automatically). Use this for: orders (get/create/append/delete), database (show tables, select queries), signatureGenerator (generate), reset, done, help.`,
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "object",
            description: "The answer payload, e.g. {tool:'orders',action:'get'} or {tool:'database',query:'select * from users'} or {tool:'signatureGenerator',action:'generate',login:'...',birthday:'...',destination:123}",
          },
        },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_food4cities",
      description: "Fetches the food4cities.json file containing the list of cities and their required items/quantities.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a warehouse operations agent. Your task is to prepare delivery orders for multiple cities using the foodwarehouse API.

## Your goal
Create one order per city listed in food4cities.json, fill each order with exactly the items and quantities that city needs, then call done.

## Step-by-step plan
1. Call reset to start fresh.
2. Fetch food4cities.json to learn which cities need orders and what items/quantities.
3. Query the database to find destination_id for each city (table: destinations, columns: destination_id, name). The API returns max 30 rows — if a city is missing, use LIMIT/OFFSET or a WHERE clause to find it.
4. Pick one user from the database (table: users) to be the creatorID for all orders. Any active user works.
5. For each city, call signatureGenerator with the chosen user's login, birthday, and the city's destination_id.
6. Delete the 4 existing seeded orders using orders.delete.
7. For each city, create a new order with the correct title, creatorID, destination, and signature.
8. For each created order, append all required items in a single batch call.
9. Call done to verify and receive the flag.

## Important rules
- The destinations table has 40 rows but only 30 are returned by default. Use SQL LIMIT/OFFSET (e.g. SELECT * FROM destinations LIMIT 10 OFFSET 30) to find missing cities.
- Match city names case-insensitively (e.g. "opalino" in JSON matches "Opalino" in DB).
- After reset, 4 seeded orders exist — delete ALL of them before creating new ones.
- Each order must have exactly the items from food4cities.json — no more, no less.
- When you see {FLG:...} in any response, print it and stop.`;

// ─── Agent loop ────────────────────────────────────────────────────────────────
async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Start the warehouse operation. Follow the plan step by step." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ── step ${step}/${MAX_STEPS} ──`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // No tool calls → agent finished
    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished:\n${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);
    if (msg.content) console.log(`[agent] reasoning: ${msg.content}`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: string;

      if (call.function.name === "hub_api") {
        const raw = await hubApi(args.answer as Record<string, unknown>);
        result = JSON.stringify(raw);
      } else if (call.function.name === "fetch_food4cities") {
        const raw = await fetchFood4Cities();
        result = JSON.stringify(raw);
      } else {
        result = `Unknown tool: ${call.function.name}`;
      }

      console.log(`[agent] ← ${result.slice(0, 300)}${result.length > 300 ? "…" : ""}`);

      // Check for flag in every response
      const flagMatch = result.match(/\{FLG:[^}]+\}/);
      if (flagMatch) {
        console.log(`\n[agent] 🏁 FLAG FOUND: ${flagMatch[0]}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        return;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ foodwarehouse agent starting ━━━");
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
