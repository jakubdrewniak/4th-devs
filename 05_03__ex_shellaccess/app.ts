// imports
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ──────────────────────────────────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) { console.error("[config] Missing AI_DEVS_KEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB = "https://hub.ag3nts.org";
const TASK = "shellaccess";
const MODEL = "anthropic/claude-sonnet-4-6";
const MAX_STEPS = 30;

// ─── Types ────────────────────────────────────────────────────────────────────
interface FindingState {
  date?: string;       // YYYY-MM-DD — day BEFORE Rafał was found
  city?: string;
  longitude?: number;
  latitude?: number;
}

interface HubResponse {
  code: number;
  message?: string;
  msg?: string;
  output?: string;
}

// ─── OpenAI client (via OpenRouter) ───────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── State ────────────────────────────────────────────────────────────────────
const state: FindingState = {};

// ─── Hub shell command execution ──────────────────────────────────────────────
async function sendCommand(cmd: string): Promise<string> {
  console.log(`[shell] $ ${cmd}`);

  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: AI_DEVS_KEY,
      task: TASK,
      answer: { cmd },
    }),
  });

  const data = (await res.json()) as HubResponse;
  const output = data.output ?? "";

  console.log(`[shell] exit code: ${data.code}`);
  if (output) console.log(`[shell] output:\n${output}`);

  // Check for flag
  const raw = JSON.stringify(data);
  const flagMatch = raw.match(/\{FLG:[^}]+\}/);
  if (flagMatch) {
    console.log(`\n[!!!] FLAG FOUND: ${flagMatch[0]}`);
  }

  // Return output + flag info so LLM sees everything
  return output || raw;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Execute a shell command on the remote server and return its stdout output.",
      parameters: {
        type: "object",
        properties: {
          cmd: {
            type: "string",
            description: "The shell command to execute, e.g. 'ls /data/', 'grep -i rafal /data/time_logs.csv | head -20'",
          },
        },
        required: ["cmd"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an investigative agent with access to a remote Linux server via shell commands.

Your goal: find when and where Rafał was found (discovered / odnaleziony), then output a JSON answer.

Available files on the server under /data/:
- time_logs.csv — time archive logs (large, use grep/head to search)
- locations.json — location/city data
- gps.json — GPS coordinates data

Strategy:
1. Search time_logs.csv for any mention of "Rafał" or "Rafal" to find the event date and location ID
2. Use locations.json to resolve the city name from the location ID
3. Use gps.json to get the longitude and latitude for that location
4. The answer date must be ONE DAY BEFORE the date Rafał was found (use: date -d "FOUND_DATE -1 day" +%Y-%m-%d)
5. Once you have all four values (date, city, longitude, latitude), execute this exact command:
   echo '{"date":"YYYY-MM-DD","city":"city name","longitude":XX.XXXXXX,"latitude":XX.XXXXXX}'

Important rules:
- Files are large — always use grep, head, or jq to extract relevant parts instead of cat
- The date in the final JSON must be the day BEFORE Rafał was found
- longitude and latitude must be numbers (not strings)
- Only call echo with the final JSON when you are confident all values are correct
- The system will detect the correct JSON and return a flag`;

// ─── Agent loop ───────────────────────────────────────────────────────────────
async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Start investigating. Find when and where Rafał was found, then submit the answer." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ━━━ step ${step}/${MAX_STEPS} ━━━`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (msg.content) {
      console.log(`[agent] reasoning: ${msg.content}`);
    }

    // No tool calls — agent finished
    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished without tool calls`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as { cmd: string };
      console.log(`[agent] → execute_command: ${args.cmd}`);

      const result = await sendCommand(args.cmd);

      // Check if flag appeared — we're done
      if (result.includes("{FLG:")) {
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        console.log("[agent] Flag received — done.");
        return;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }

    // Log current state awareness
    console.log(`[state] date=${state.date ?? "?"} city=${state.city ?? "?"} lon=${state.longitude ?? "?"} lat=${state.latitude ?? "?"}`);
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ shellaccess — starting agent ━━━");
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
