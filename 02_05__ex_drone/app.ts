import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import OpenAI from "openai";

// ─── Load .env from project root ─────────────────────────────────────────────

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

const HUB_URL = "https://hub.ag3nts.org/verify";
const DRONE_MAP_URL = `https://hub.ag3nts.org/data/${AI_DEVS_KEY}/drone.png`;
const PLANT_ID = "PWR6132PL";
const MODEL_VISION = "openai/gpt-5.4";
const MODEL_AGENT = "openai/gpt-4.1-mini";

console.log("[config] Setup complete ✓");
console.log("[config] AI_DEVS_KEY:", AI_DEVS_KEY.slice(0, 8) + "...");
console.log("[config] Map URL:", DRONE_MAP_URL);
console.log("[config] Plant ID:", PLANT_ID);
console.log("[config] Vision model:", MODEL_VISION);
console.log("[config] Agent model:", MODEL_AGENT);

// ─── OpenAI client (OpenRouter) ───────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

console.log("[config] OpenAI client initialized ✓");

// ─── STEP 2: Analyze map — find dam sector ───────────────────────────────────

type MapCoords = { x: number; y: number };

async function analyzeMap(): Promise<MapCoords> {
  console.log("[analyzeMap] Sending map to vision model:", MODEL_VISION);
  console.log("[analyzeMap] Map URL:", DRONE_MAP_URL);

  const response = await openai.chat.completions.create({
    model: MODEL_VISION,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: DRONE_MAP_URL },
          },
          {
            type: "text",
            text: `This is a grid map of a nuclear power plant area.
Your task:
1. Count the total number of columns and rows in the grid.
2. Find the sector containing a DAM (tama) — it is marked by an intentionally enhanced/intensified water color compared to surroundings.
3. Return the column (x) and row (y) of the dam sector. Top-left corner is x=1, y=1. Columns go left-to-right, rows go top-to-bottom.

Respond ONLY with a JSON object, no markdown, no explanation:
{"x": <column>, "y": <row>, "gridCols": <total columns>, "gridRows": <total rows>, "reasoning": "<brief one-line explanation>"}`,
          },
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  console.log("[analyzeMap] Raw vision response:\n", raw);

  const jsonStr = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonStr) as MapCoords & { gridCols: number; gridRows: number; reasoning: string };

  console.log(`[analyzeMap] Grid size: ${parsed.gridCols} cols × ${parsed.gridRows} rows`);
  console.log(`[analyzeMap] Dam sector: x=${parsed.x}, y=${parsed.y}`);
  console.log(`[analyzeMap] Reasoning: ${parsed.reasoning}`);

  return { x: parsed.x, y: parsed.y };
}

// ─── STEP 3: Agent tools ──────────────────────────────────────────────────────

type ToolResult = { raw: unknown; flag: string | null };

async function submitInstructions(instructions: string[]): Promise<ToolResult> {
  console.log("[submit_instructions] Sending:", JSON.stringify(instructions));

  const res = await fetch(HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: AI_DEVS_KEY,
      task: "drone",
      answer: { instructions },
    }),
  });

  const data = await res.json();
  console.log("[submit_instructions] Response:", JSON.stringify(data, null, 2));

  const flagMatch = JSON.stringify(data).match(/\{FLG:[^}]+\}/);
  return { raw: data, flag: flagMatch ? flagMatch[0] : null };
}

async function hardReset(): Promise<ToolResult> {
  console.log("[hard_reset] Resetting drone to factory state...");
  return submitInstructions(["hardReset"]);
}

// Tool definitions for the LLM (OpenAI tool_use format)
const AGENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "submit_instructions",
      description: "Send an array of drone instructions to the /verify API endpoint. Returns the API response. Read the response carefully — it contains error messages or a flag.",
      parameters: {
        type: "object",
        properties: {
          instructions: {
            type: "array",
            items: { type: "string" },
            description: "Array of drone API instruction strings, e.g. [\"setDestinationObject(PWR6132PL)\", \"set(3,5)\", \"set(50m)\", \"set(destroy)\", \"flyToLocation\"]",
          },
        },
        required: ["instructions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hard_reset",
      description: "Reset the drone to factory state. Use this if the drone configuration is corrupted or errors are cascading from previous bad instructions.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── STEP 4: Agent loop ───────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

function buildSystemPrompt(damCoords: MapCoords): string {
  return `You are controlling a military drone (DRN-BMB7) via its API.

## Mission
The declared destination is the nuclear plant with ID: ${PLANT_ID}.
However, the bomb must land on the DAM sector, not the plant.
The dam is located at grid sector x=${damCoords.x}, y=${damCoords.y} (column=${damCoords.x}, row=${damCoords.y}, top-left is 1,1).

## Drone API — required instructions
Use ONLY what is necessary for the mission:
- setDestinationObject(ID)   — sets the flight destination object (use ${PLANT_ID})
- set(x,y)                  — sets the ACTUAL landing/bomb-drop sector (use x=${damCoords.x}, y=${damCoords.y} for the dam)
- set(engineON)             — turns the engines on. Required before flyToLocation.
- set(100%)                 — sets engine power to 100%. Required before flyToLocation.
- set(Xm)                   — sets flight altitude in meters, e.g. set(50m). Required before flyToLocation.
- set(destroy)              — sets mission goal to destroy the target
- flyToLocation             — starts the flight. Requires altitude, destination, sector, engine ON and power to be set first.

## Strategy
1. Send your best attempt with submit_instructions.
2. Read the API response carefully — it contains precise error messages.
3. Adjust instructions based on the error and retry.
4. Use hard_reset only if errors are cascading from corrupted state.
5. Stop when the response contains {FLG:...}.

## Important
- set(x,y) overrides where the bomb actually drops — this is how we hit the dam instead of the plant.
- Do not add unnecessary instructions (LED, name, owner, calibration etc.).
- Respond only by calling tools. Do not explain your reasoning in text.`;
}

async function runAgentLoop(damCoords: MapCoords): Promise<void> {
  console.log("[agent] Starting agent loop...");
  console.log(`[agent] Target dam sector: x=${damCoords.x}, y=${damCoords.y}`);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(damCoords) },
    { role: "user", content: "Execute the mission. Send the drone instructions to the API." },
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n[agent] ── Iteration ${iteration}/${MAX_ITERATIONS} ──`);

    const response = await openai.chat.completions.create({
      model: MODEL_AGENT,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    console.log(`[agent] Stop reason: ${choice.finish_reason}`);

    // Append assistant message to history
    messages.push(choice.message);

    // No tool calls — agent decided to stop
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      console.log("[agent] Agent stopped without tool calls.");
      if (choice.message.content) {
        console.log("[agent] Agent message:", choice.message.content);
      }
      break;
    }

    // Execute each tool call
    for (const toolCall of choice.message.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments ?? "{}");
      console.log(`[agent] Tool call: ${name}`, args);

      let result: ToolResult;

      if (name === "submit_instructions") {
        result = await submitInstructions(args.instructions as string[]);
      } else if (name === "hard_reset") {
        result = await hardReset();
      } else {
        result = { raw: { error: `Unknown tool: ${name}` }, flag: null };
      }

      // Append tool result to history so agent sees the API response
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result.raw),
      });

      if (result.flag) {
        console.log(`\n[agent] 🎯 FLAG FOUND: ${result.flag}`);
        return;
      }
    }
  }

  console.log("\n[agent] Max iterations reached without finding flag.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n━━━ STEP 2: Analyzing map ━━━");
  const damCoords = await analyzeMap();
  console.log(`\n[main] Dam located at: set(${damCoords.x},${damCoords.y})`);

  console.log("\n━━━ STEP 4: Running agent loop ━━━");
  await runAgentLoop(damCoords);
}

main().catch((err) => { console.error("[error]", err.message); process.exit(1); });
