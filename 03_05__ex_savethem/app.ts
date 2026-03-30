import OpenAI from "openai";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env ────────────────────────────────────────────────────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const AI_DEVS_KEY    = process.env.AI_DEVS_KEY?.trim()          ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim()   ?? "";

if (!AI_DEVS_KEY)    { console.error("[config] Missing AI_DEVS_KEY");         process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY");  process.exit(1); }

const HUB   = "https://hub.ag3nts.org";
const MODEL = "openai/gpt-4.1-mini";

const openai = new OpenAI({ apiKey: OPENROUTER_KEY, baseURL: "https://openrouter.ai/api/v1" });

// ─── Types ────────────────────────────────────────────────────────────────────
type Vehicle  = "rocket" | "car" | "horse" | "walk";
type Direction = "up" | "down" | "left" | "right";
type Move      = Direction | "dismount";

interface VehicleStats {
  fuelPerMove:    number;
  foodPerMove:    number;
  canCrossWater:  boolean;
}

interface PathState {
  row: number; col: number; vehicle: Vehicle;
  fuelUsed: number; foodUsed: number;
  moves: Move[];
}

// ─── Agent state (filled by call_tool side effects) ───────────────────────────
let collectedMap: string[][] | null = null;
const collectedVehicles: Partial<Record<Vehicle, VehicleStats>> = {};

// Water crossing rules come from /api/books (step 5) — hardcoded here
const CAN_CROSS_WATER: Record<Vehicle, boolean> = {
  rocket: false, car: false, horse: true, walk: true,
};

// ─── Hub helpers ──────────────────────────────────────────────────────────────
async function hubPost(endpoint: string, query: string): Promise<unknown> {
  const res = await fetch(`${HUB}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${endpoint}: ${text}`);
  return JSON.parse(text);
}

// ─── Tool implementations ─────────────────────────────────────────────────────
async function toolSearchImpl(query: string): Promise<unknown> {
  console.log(`[tool_search] query="${query}"`);
  const data = await hubPost("/api/toolsearch", query) as { tools: unknown[] };
  console.log(`[tool_search] found ${data.tools?.length ?? 0} tool(s)`);
  return data;
}

async function callToolImpl(url: string, query: string): Promise<unknown> {
  console.log(`[call_tool] POST ${url} query="${query}"`);
  const data = await hubPost(url, query) as Record<string, unknown>;
  console.log(`[call_tool] response code=${data["code"]}`);

  // Side effect: collect map
  if (Array.isArray(data["map"])) {
    collectedMap = data["map"] as string[][];
    console.log(`[call_tool] ✓ map collected (${collectedMap.length} rows)`);
  }

  // Side effect: collect vehicle stats
  if (typeof data["name"] === "string" && data["consumption"]) {
    const name = data["name"] as Vehicle;
    const c = data["consumption"] as { fuel: number; food: number };
    collectedVehicles[name] = {
      fuelPerMove:   c.fuel,
      foodPerMove:   c.food,
      canCrossWater: CAN_CROSS_WATER[name] ?? false,
    };
    console.log(`[call_tool] ✓ vehicle "${name}" collected (fuel=${c.fuel} food=${c.food})`);
  }

  return data;
}

// ─── Pathfinding (BFS) ────────────────────────────────────────────────────────
const FUEL_BUDGET  = 10;
const FOOD_BUDGET  = 10;
const TREE_EXTRA_FUEL = 0.2;

function findPath(map: string[][], startVehicle: Vehicle, stats: VehicleStats): PathState | null {
  const ROWS = map.length, COLS = map[0].length;
  let sr = -1, sc = -1, gr = -1, gc = -1;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (map[r][c] === "S") { sr = r; sc = c; }
      if (map[r][c] === "G") { gr = r; gc = c; }
    }

  const DIRS: { dir: Direction; dr: number; dc: number }[] = [
    { dir: "up", dr: -1, dc: 0 }, { dir: "down", dr: 1, dc: 0 },
    { dir: "left", dr: 0, dc: -1 }, { dir: "right", dr: 0, dc: 1 },
  ];

  const visited = new Map<string, number>();
  const queue: PathState[] = [{ row: sr, col: sc, vehicle: startVehicle, fuelUsed: 0, foodUsed: 0, moves: [] }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.moves.length - b.moves.length);
    const s = queue.shift()!;
    if (s.row === gr && s.col === gc) return s;

    const key = `${s.row},${s.col},${s.vehicle}`;
    if ((visited.get(key) ?? Infinity) <= s.moves.length) continue;
    visited.set(key, s.moves.length);

    const curStats = s.vehicle === startVehicle ? stats : { fuelPerMove: 0, foodPerMove: 2.5, canCrossWater: true };

    // Move
    for (const { dir, dr, dc } of DIRS) {
      const nr = s.row + dr, nc = s.col + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const cell = map[nr][nc];
      if (cell === "R") continue;
      if (cell === "W" && !curStats.canCrossWater) continue;

      const extraFuel = cell === "T" && curStats.fuelPerMove > 0 ? TREE_EXTRA_FUEL : 0;
      const nFuel = s.fuelUsed + curStats.fuelPerMove + extraFuel;
      const nFood = s.foodUsed + curStats.foodPerMove;
      if (nFuel > FUEL_BUDGET || nFood > FOOD_BUDGET) continue;

      queue.push({ ...s, row: nr, col: nc, fuelUsed: nFuel, foodUsed: nFood, moves: [...s.moves, dir] });
    }

    // Dismount
    if (s.vehicle !== "walk") {
      const wKey = `${s.row},${s.col},walk`;
      if ((visited.get(wKey) ?? Infinity) > s.moves.length)
        queue.push({ ...s, vehicle: "walk", moves: [...s.moves, "dismount"] });
    }
  }
  return null;
}

async function submitRouteImpl(): Promise<unknown> {
  console.log("\n[submit_route] Running pathfinding...");

  if (!collectedMap) throw new Error("No map collected — call maps tool first");
  const vehicles = Object.keys(collectedVehicles) as Vehicle[];
  if (vehicles.length === 0) throw new Error("No vehicles collected — call vehicles tool first");

  const results: { vehicle: Vehicle; path: PathState }[] = [];
  for (const v of vehicles) {
    const stats = collectedVehicles[v]!;
    const p = findPath(collectedMap, v, stats);
    if (p) {
      console.log(`  [✓] ${v}: ${p.moves.length} moves | fuel=${p.fuelUsed.toFixed(2)} food=${p.foodUsed.toFixed(2)}`);
      results.push({ vehicle: v, path: p });
    } else {
      console.log(`  [✗] ${v}: no valid path`);
    }
  }

  if (results.length === 0) return { error: "No valid path found for any vehicle" };

  const best = results.reduce((a, b) =>
    (FUEL_BUDGET - a.path.fuelUsed + FOOD_BUDGET - a.path.foodUsed) >
    (FUEL_BUDGET - b.path.fuelUsed + FOOD_BUDGET - b.path.foodUsed) ? a : b
  );

  const answer = [best.vehicle, ...best.path.moves];
  console.log(`[submit_route] Best: ${best.vehicle} — ${best.path.moves.join(" → ")}`);
  console.log(`[submit_route] Submitting: ${JSON.stringify(answer)}`);

  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "savethem", answer }),
  });
  const data = await res.json();
  console.log("[submit_route] Hub response:", JSON.stringify(data, null, 2));

  const flag = JSON.stringify(data).match(/\{FLG:[^}]+\}/);
  if (flag) console.log(`\n[submit_route] FLAG FOUND: ${flag[0]}`);

  return data;
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "tool_search",
      description: "Search for available tools by keyword. Returns up to 3 matching tools with their API URLs.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Keywords to search for" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_tool",
      description: "Call a discovered tool by its URL. All tools accept a 'query' string and return JSON.",
      parameters: {
        type: "object",
        properties: {
          url:   { type: "string", description: "Relative URL of the tool, e.g. /api/maps" },
          query: { type: "string", description: "Query string to send to the tool" },
        },
        required: ["url", "query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_route",
      description: "Run pathfinding on collected data and submit the optimal route to the hub. Call this once you have the map and all vehicle stats.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a navigation planning agent. Your goal is to gather all data needed to route a messenger to the city of Skolwin, then submit the optimal route.

Steps you must perform:
1. Use tool_search to find the maps tool, then call it with query "Skolwin" to get the terrain map.
2. Use tool_search to find the vehicles tool. Then call it 4 times — once for each vehicle: rocket, horse, walk, car.
3. Once you have the map and all 4 vehicle stats, call submit_route (no arguments needed).

Rules you already know:
- All tools accept a "query" string and return JSON.
- Communicate only in English.`;

// ─── Agent loop ───────────────────────────────────────────────────────────────
const MAX_STEPS = 30;

async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system",  content: SYSTEM_PROMPT },
    { role: "user",    content: "Start gathering data and submit the optimal route to Skolwin." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ── step ${step}/${MAX_STEPS} ──`);

    const response = await openai.chat.completions.create({ model: MODEL, messages, tools, tool_choice: "auto" });
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished: ${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, string>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: unknown;
      try {
        if (call.function.name === "tool_search") {
          result = await toolSearchImpl(args["query"]);
        } else if (call.function.name === "call_tool") {
          result = await callToolImpl(args["url"], args["query"]);
        } else if (call.function.name === "submit_route") {
          result = await submitRouteImpl();
          // Check flag
          if (JSON.stringify(result).match(/\{FLG:[^}]+\}/)) return;
        } else {
          result = { error: `Unknown tool: ${call.function.name}` };
        }
      } catch (err) {
        result = { error: (err as Error).message };
        console.error(`[agent] tool error: ${(err as Error).message}`);
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ savethem — autonomous agent ━━━");
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
