// Opcja B — Ukierunkowany prompt: Dodatkowo wpisujemy w prompt gotową sugestię trasy (np. "użyj transportera, jedź do D9, wysadź zwiadowców, idź do B9/C9/I9 i sprawdź B3"). 
// Agent ma mniej do wymyślenia, ale skupia się na egzekucji.

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
const TASK = "domatowo";
const MODEL = "openai/gpt-4o";
const MAX_STEPS = 60;

// ─── Types ────────────────────────────────────────────────────────────────────
interface HubResponse {
  code?: number;
  message?: string;
  [key: string]: unknown;
}

// ─── OpenAI client (OpenRouter) ───────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Core API helper ──────────────────────────────────────────────────────────
async function callHub(answer: Record<string, unknown>): Promise<HubResponse> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<HubResponse>;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function resetGame(): Promise<HubResponse> {
  return callHub({ action: "reset" });
}

async function getObjects(): Promise<HubResponse> {
  return callHub({ action: "getObjects" });
}

async function createUnit(type: "scout" | "transporter", passengers?: number): Promise<HubResponse> {
  const payload: Record<string, unknown> = { action: "create", type };
  if (type === "transporter" && passengers != null) {
    payload.passengers = passengers;
  }
  return callHub(payload);
}

async function moveUnit(unitHash: string, where: string): Promise<HubResponse> {
  return callHub({ action: "move", object: unitHash, where });
}

async function inspectField(scoutHash: string): Promise<HubResponse> {
  return callHub({ action: "inspect", object: scoutHash });
}

async function dismountScouts(transporterHash: string, passengers: number): Promise<HubResponse> {
  return callHub({ action: "dismount", object: transporterHash, passengers });
}

async function getLogs(): Promise<HubResponse> {
  return callHub({ action: "getLogs" });
}

async function callHelicopter(destination: string): Promise<HubResponse> {
  return callHub({ action: "callHelicopter", destination });
}

async function searchSymbol(symbol: string): Promise<HubResponse> {
  return callHub({ action: "searchSymbol", symbol });
}

async function getActionCost(): Promise<HubResponse> {
  return callHub({ action: "actionCost" });
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getObjects",
      description: "Returns all current units (scouts and transporters) with their hash IDs and positions on the map. Call this after creating units or after moves to know current state.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "createUnit",
      description: "Creates a new unit at the next available spawn slot (A6→D6). Use type='transporter' with passengers=N to create a transporter carrying N scouts in one action. Use type='scout' to create a lone scout.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["scout", "transporter"], description: "Unit type to create" },
          passengers: { type: "number", description: "Number of scouts to load (1–4). Required when type is 'transporter'." },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moveUnit",
      description: "Moves a unit to the target map coordinate (e.g. 'D9'). Transporters follow road-only paths (1 pt/field). Scouts take the shortest orthogonal path (7 pt/field). Use getObjects first to get the unit hash.",
      parameters: {
        type: "object",
        properties: {
          unitHash: { type: "string", description: "The hash ID of the unit to move" },
          where: { type: "string", description: "Target coordinate in A1..K11 format (e.g. 'D9')" },
        },
        required: ["unitHash", "where"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspectField",
      description: "Makes a scout inspect the field it currently stands on (cost: 1 pt). Results appear in getLogs. The scout must already be on the field to inspect.",
      parameters: {
        type: "object",
        properties: {
          scoutHash: { type: "string", description: "The hash ID of the scout performing the inspection" },
        },
        required: ["scoutHash"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismountScouts",
      description: "Dismounts N scouts from a transporter onto free adjacent tiles (cost: 0 pts). Do this after moving the transporter close to target buildings.",
      parameters: {
        type: "object",
        properties: {
          transporterHash: { type: "string", description: "The hash ID of the transporter" },
          passengers: { type: "number", description: "Number of scouts to dismount (1–4)" },
        },
        required: ["transporterHash", "passengers"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLogs",
      description: "Returns all inspection log entries. Call this after inspect actions to see results — especially to check if any scout found the partisan.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "callHelicopter",
      description: "Calls the evacuation helicopter to the given map coordinate. Only call this AFTER getLogs confirms that a scout found a human at that location. This costs 0 points.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Coordinate where the partisan was found, e.g. 'F1'" },
        },
        required: ["destination"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `You are a tactical commander coordinating an evacuation mission in the ruined city of Domatowo.

OBJECTIVE: Locate a partisan hiding in a 3-floor block (B3 — the tallest buildings in the city) and call the evacuation helicopter to his exact location.

MAP LAYOUT (11x11 grid, columns A–K left to right, rows 1–11 top to bottom):

     A    B    C    D    E    F    G    H    I    J    K
1  [ DR ] [UL ] [UL ] [UL ] [   ] [B3 ] [B3 ] [DR ] [   ] [PK ] [PK ]
2  [ DR ] [DR ] [   ] [UL ] [UL ] [B3 ] [B3 ] [DR ] [UL ] [PK ] [PK ]
3  [    ] [   ] [   ] [UL ] [PK ] [   ] [   ] [DR ] [UL ] [   ] [   ]
4  [ B1 ] [B1 ] [   ] [UL ] [PK ] [SZ ] [SZ ] [SZ ] [UL ] [BS ] [BS ]
5  [ B1 ] [B1 ] [   ] [UL ] [PK ] [SZ ] [SZ ] [SZ ] [UL ] [BS ] [BS ]
6  [ UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [   ]  ← SPAWN ROW
7  [ B2 ] [B2 ] [   ] [UL ] [   ] [KS ] [KS ] [KS ] [   ] [DR ] [   ]
8  [ B2 ] [B2 ] [   ] [UL ] [   ] [KS ] [KS ] [KS ] [   ] [DR ] [   ]
9  [    ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [   ]
10 [ B3 ] [B3 ] [B3 ] [   ] [DR ] [   ] [   ] [B3 ] [B3 ] [DR ] [   ]
11 [ B3 ] [B3 ] [B3 ] [   ] [DR ] [   ] [   ] [B3 ] [B3 ] [DR ] [   ]

Map legend: UL=road, DR=trees, B1/B2/B3=blocks(1/2/3 floors), KS=church, SZ=school, PK=parking, BS=field

TARGET — B3 TILES (partisan is in exactly ONE of these 14 tiles, chosen at random):
  CLUSTER NORTH:      F1, G1, F2, G2
  CLUSTER SOUTH-WEST: A10, B10, C10, A11, B11, C11
  CLUSTER SOUTH-EAST: H10, I10, H11, I11

ROAD NETWORK (transporters can only move on UL tiles):
  - Row 6:  A6–J6 (main road — spawn row)
  - Row 9:  B9–J9
  - Col D:  D1–D9 (full vertical connector)
  - Col I:  I2–I6, then I9 (gap at I7–I8, no road connection south of I6 except via row 9)
  - Row 1:  B1–D1
  - Row 2:  D2–E2, I2

UNIT SPAWN SLOTS: A6, B6, C6, D6 (units appear here in order)

ACTION COSTS:
  - Create scout:                        5 pts
  - Create transporter with N scouts:    5 + N×5 pts
  - Move transporter:                    1 pt per field (road-only path)
  - Move scout:                          7 pts per field (any tile, shortest orthogonal path)
  - Inspect field (scout):               1 pt
  - Dismount scouts from transporter:    0 pts
  - callHelicopter / getLogs / getObjects: 0 pts
  TOTAL BUDGET: 300 action points

SUGGESTED STRATEGY (optimized for point budget):
  1. Create transporter T1 with 2 scouts (15 pts): send to CLUSTER NORTH
     Route: spawn A6 → D6 (3 pts) → D1 (5 pts) = 8 pts transporter movement
     Dismount at D1. Scouts walk to F1, G1, F2, G2 (2 fields each = 14 pts/scout)

  2. Create transporter T2 with 3 scouts (20 pts): send to CLUSTER SOUTH
     Route: spawn → D6 → D9 (6 pts) → B9 (2 pts) = 8 pts to south-west
     Dismount 2 scouts at B9 for south-west B3 tiles.
     Move T2 onward: B9 → I9 (7 pts). Dismount last scout for south-east B3 tiles.

  3. After each inspect, call getLogs to check results.
     As soon as any log entry confirms a human was found, immediately call callHelicopter
     with the coordinate where the scout found the partisan.

WORKFLOW RULES:
  - Always call getObjects after creating or moving units to get current hash IDs and positions.
  - Always call getLogs after every batch of inspections.
  - Minimize scout walking: position transporters as close to B3 tiles as possible before dismounting.
  - The partisan is in exactly one B3 tile. Stop inspecting as soon as he is found.
  - Do NOT call callHelicopter until getLogs explicitly confirms a human at that location.`;
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────
async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "getObjects":
      return JSON.stringify(await getObjects());

    case "createUnit":
      return JSON.stringify(await createUnit(
        args.type as "scout" | "transporter",
        args.passengers as number | undefined,
      ));

    case "moveUnit":
      return JSON.stringify(await moveUnit(
        args.unitHash as string,
        args.where as string,
      ));

    case "inspectField":
      return JSON.stringify(await inspectField(args.scoutHash as string));

    case "dismountScouts":
      return JSON.stringify(await dismountScouts(
        args.transporterHash as string,
        args.passengers as number,
      ));

    case "getLogs":
      return JSON.stringify(await getLogs());

    case "callHelicopter":
      return JSON.stringify(await callHelicopter(args.destination as string));

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────
async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: "Board has been reset. Begin the evacuation operation. Find the partisan and call the helicopter." },
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

    // No tool calls — agent finished reasoning
    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished: ${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      const result = await dispatchTool(call.function.name, args);
      const parsed = JSON.parse(result) as Record<string, unknown>;
      console.log(`[agent] ← ${JSON.stringify(parsed)}`);

      // Check for flag in every response
      const flagMatch = result.match(/\{FLG:[^}]+\}/);
      if (flagMatch) {
        console.log(`\n[agent] 🎯 FLAG FOUND: ${flagMatch[0]}`);
        return;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {

  console.log("\n━━━ STEP 1: Reset game (fresh state) ━━━");
  const resetResult = await resetGame();
  console.log(JSON.stringify(resetResult));
  if (resetResult.status !== "ok" && resetResult.code !== 50) {
    throw new Error("Reset failed");
  }
  console.log("[OK] Game reset");

  console.log("\n━━━ STEP 2: Run agent ━━━");
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
