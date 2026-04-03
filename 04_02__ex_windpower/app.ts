// ─── Imports ──────────────────────────────────────────────────────────────────
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
const TASK = "windpower";
const MODEL = "openai/gpt-4.1-mini";

// ─── OpenAI client (via OpenRouter) ───────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface HubResponse {
  code: number;
  message?: string;
  [key: string]: unknown;
}

interface GetResultResponse extends HubResponse {
  sourceFunction: string;
}

interface ConfigPoint {
  startDate: string;
  startHour: string;
  windMs: number;
  pitchAngle: number;
  turbineMode: "production" | "idle";
  unlockCode?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function callApi(answer: Record<string, unknown>): Promise<HubResponse> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  const data = (await res.json()) as HubResponse;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls getResult until all unique sourceFunctions from `expected` are collected
async function pollAllResults(
  expected: string[],
  intervalMs = 500,
  maxAttempts = 60
): Promise<Map<string, HubResponse>> {
  const collected = new Map<string, HubResponse>();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (collected.size === expected.length) break;
    const result = (await callApi({ action: "getResult" })) as GetResultResponse;
    if (result.sourceFunction) {
      if (expected.includes(result.sourceFunction) && !collected.has(result.sourceFunction)) {
        console.log(`  [poll] ✓ ${result.sourceFunction}`);
        collected.set(result.sourceFunction, result);
      }
    } else {
      await sleep(intervalMs);
    }
  }
  if (collected.size < expected.length) {
    throw new Error(`[poll] Timed out. Missing: ${expected.filter((e) => !collected.has(e)).join(", ")}`);
  }
  return collected;
}

// Polls getResult exactly `count` times for a given sourceFunction
async function pollNResultsBySource(
  sourceFunction: string,
  count: number,
  intervalMs = 500,
  maxAttempts = 120
): Promise<HubResponse[]> {
  const collected: HubResponse[] = [];
  for (let attempt = 0; attempt < maxAttempts && collected.length < count; attempt++) {
    const result = (await callApi({ action: "getResult" })) as GetResultResponse;
    if (result.sourceFunction === sourceFunction) {
      console.log(`  [poll] ✓ unlockCode ${collected.length + 1}/${count}`);
      collected.push(result);
    } else if (result.sourceFunction) {
      console.log(`  [poll] skipping: ${result.sourceFunction}`);
    } else {
      await sleep(intervalMs);
    }
  }
  if (collected.length < count) {
    throw new Error(`[poll:${sourceFunction}] Timed out. Got ${collected.length}/${count}`);
  }
  return collected;
}

// ─── Tool implementations ──────────────────────────────────────────────────────
// Each tool handles its own async polling internally — LLM sees clean results.

async function toolGetAllData(): Promise<string> {
  // Start session here — the 40s clock starts NOW, not before LLM decided what to do
  console.log("\n  [tool: get_all_data] Starting session...");
  const startResponse = await callApi({ action: "start" });
  if (startResponse.code !== 60) throw new Error(`start failed: ${startResponse.code}`);
  console.log(`  [tool: get_all_data] Session open (${startResponse.sessionTimeout}s window)`);

  // documentation (sync) + enqueue async calls — all in one parallel batch
  console.log("  [tool: get_all_data] Fetching doc + enqueueing async data in parallel...");
  const [doc] = await Promise.all([
    callApi({ action: "get", param: "documentation" }),
    callApi({ action: "get", param: "weather" }),
    callApi({ action: "get", param: "turbinecheck" }),
    callApi({ action: "get", param: "powerplantcheck" }),
  ]);

  console.log("  [tool: get_all_data] Polling async results...");
  const results = await pollAllResults(["weather", "turbinecheck", "powerplantcheck"]);

  const payload = {
    documentation: doc,
    weather: results.get("weather"),
    turbinecheck: results.get("turbinecheck"),
    powerplantcheck: results.get("powerplantcheck"),
  };

  console.log("  [tool: get_all_data] Done.");
  return JSON.stringify(payload);
}

// Combines: generate unlock codes + send config + turbinecheck + done
// Reduces agent steps from 4 to 2 (critical for 40s time limit)
async function toolExecutePlan(configs: ConfigPoint[]): Promise<string> {
  // 1. Generate unlock codes for all config points in parallel
  console.log(`\n  [tool: execute_plan] Generating ${configs.length} unlock codes...`);
  await Promise.all(
    configs.map((p) =>
      callApi({
        action: "unlockCodeGenerator",
        startDate: p.startDate,
        startHour: p.startHour,
        windMs: p.windMs,
        pitchAngle: p.pitchAngle,
      })
    )
  );
  const unlockResults = await pollNResultsBySource("unlockCodeGenerator", configs.length);

  const unlockMap = new Map<string, string>();
  for (const r of unlockResults) {
    const signed = r.signedParams as { startDate: string; startHour: string };
    unlockMap.set(`${signed.startDate} ${signed.startHour}`, r.unlockCode as string);
  }

  // 2. Build batch config and send
  console.log("  [tool: execute_plan] Sending configuration...");
  const batchConfigs: Record<string, { pitchAngle: number; turbineMode: string; unlockCode: string }> = {};
  for (const p of configs) {
    const code = unlockMap.get(`${p.startDate} ${p.startHour}`);
    if (!code) throw new Error(`No unlock code for ${p.startDate} ${p.startHour}`);
    batchConfigs[`${p.startDate} ${p.startHour}`] = {
      pitchAngle: p.pitchAngle,
      turbineMode: p.turbineMode,
      unlockCode: code,
    };
  }
  const configResponse = await callApi({ action: "config", configs: batchConfigs });
  console.log("  [tool: execute_plan] Config response:", JSON.stringify(configResponse));

  // 3. Turbinecheck (required before done)
  console.log("  [tool: execute_plan] Running turbinecheck...");
  await callApi({ action: "get", param: "turbinecheck" });
  const [turbineResult] = await pollNResultsBySource("turbinecheck", 1);
  console.log("  [tool: execute_plan] Turbinecheck:", JSON.stringify(turbineResult));

  // 4. Done
  console.log("  [tool: execute_plan] Sending done...");
  const doneResponse = await callApi({ action: "done" });
  console.log("  [tool: execute_plan] Done response:", JSON.stringify(doneResponse));
  return JSON.stringify(doneResponse);
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_all_data",
      description:
        "Fetches turbine documentation (specs, cutoff wind speed, pitch angles) and all operational data: " +
        "weather forecast (7 days, 2h intervals), turbine status, and power plant energy requirements. " +
        "Always call this first.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_plan",
      description:
        "Executes the full plan: generates unlock codes for all config points, sends the configuration, " +
        "runs turbine check, and submits done. Call this after get_all_data with your full config plan.",
      parameters: {
        type: "object",
        properties: {
          configs: {
            type: "array",
            description: "All configuration points — storms (idle+pitch90) AND the production slot (production+pitch0).",
            items: {
              type: "object",
              properties: {
                startDate: { type: "string", description: "Date in YYYY-MM-DD format" },
                startHour: { type: "string", description: "Hour as HH:00:00 (always 00 minutes and seconds)" },
                windMs: { type: "number", description: "EXACT wind speed from weather forecast for this slot" },
                pitchAngle: { type: "number", enum: [0, 45, 90], description: "Blade pitch in degrees" },
                turbineMode: { type: "string", enum: ["production", "idle"] },
              },
              required: ["startDate", "startHour", "windMs", "pitchAngle", "turbineMode"],
              additionalProperties: false,
            },
          },
        },
        required: ["configs"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a wind turbine scheduling agent. Your goal is to configure a turbine schedule
so the power plant receives enough energy. You must complete the task in exactly 2 steps.

Step 1: call get_all_data — fetch turbine specs and weather forecast.
Step 2: call execute_plan — pass your full config plan based on the data.

Rules for building the config plan:
- STORMS: every slot where wind > cutoffWindMs (from documentation) → pitchAngle=90, turbineMode="idle"
- PRODUCTION: the single best slot where wind is between 4 m/s and cutoffWindMs → pitchAngle=0, turbineMode="production"
- Use the EXACT windMs value from the weather forecast for each slot
- Hours must be in format "HH:00:00" (minutes and seconds always zero)`;

// ─── Agent loop ────────────────────────────────────────────────────────────────
async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Start the turbine scheduling process now." },
  ];

  const MAX_STEPS = 10;

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

    if (!msg.tool_calls?.length) {
      console.log(`[agent] Finished: ${msg.content}`);

      // Check for flag in message content
      const flagMatch = msg.content?.match(/\{FLG:[^}]+\}/);
      if (flagMatch) console.log(`\n[SUCCESS] FLAG: ${flagMatch[0]}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s):`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`\n[agent] → ${call.function.name}(${Object.keys(args).join(", ")})`);

      let result: string;

      if (call.function.name === "get_all_data") {
        result = await toolGetAllData();

      } else if (call.function.name === "execute_plan") {
        result = await toolExecutePlan(args.configs as ConfigPoint[]);

        const flagMatch = result.match(/\{FLG:[^}]+\}/);
        if (flagMatch) {
          console.log(`\n[SUCCESS] FLAG: ${flagMatch[0]}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
          return;
        }

      } else {
        result = JSON.stringify({ error: `Unknown tool: ${call.function.name}` });
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // start is called inside toolGetAllData — the 40s window won't begin until
  // the LLM has already decided to act, minimizing wasted session time
  console.log("\n━━━ Running agent ━━━");
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
