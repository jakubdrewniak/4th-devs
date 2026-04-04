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

/** Resets the game board — new partisan position, full action points */
async function resetGame(): Promise<HubResponse> {
  return callHub({ action: "reset" });
}

/** Returns all units (scouts, transporters) with their hash IDs and positions */
async function getObjects(): Promise<HubResponse> {
  return callHub({ action: "getObjects" });
}

/** Creates a scout or a transporter (with N scouts already aboard) */
async function createUnit(type: "scout" | "transporter", passengers?: number): Promise<HubResponse> {
  const payload: Record<string, unknown> = { action: "create", type };
  if (type === "transporter" && passengers != null) {
    payload.passengers = passengers;
  }
  return callHub(payload);
}

/**
 * Moves a unit to the target coordinate.
 * Transporters use road-only pathfinding; scouts take the shortest orthogonal path.
 */
async function moveUnit(unitHash: string, where: string): Promise<HubResponse> {
  return callHub({ action: "move", object: unitHash, where });
}

/** Scout inspects the field it currently stands on */
async function inspectField(scoutHash: string): Promise<HubResponse> {
  return callHub({ action: "inspect", object: scoutHash });
}

/** Dismounts N scouts from a transporter onto adjacent free tiles */
async function dismountScouts(transporterHash: string, passengers: number): Promise<HubResponse> {
  return callHub({ action: "dismount", object: transporterHash, passengers });
}

/** Returns all inspection log entries collected so far */
async function getLogs(): Promise<HubResponse> {
  return callHub({ action: "getLogs" });
}

/** Calls the evacuation helicopter to the given coordinate */
async function callHelicopter(destination: string): Promise<HubResponse> {
  return callHub({ action: "callHelicopter", destination });
}

/** Returns all map fields matching a 2-character symbol (e.g. "B3") */
async function searchSymbol(symbol: string): Promise<HubResponse> {
  return callHub({ action: "searchSymbol", symbol });
}

/** Returns the action point cost rules */
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
      description: "Calls the evacuation helicopter to the given map coordinate. Only call this AFTER getLogs confirms that a scout found a human at that location.",
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

// ─── Main (Step 2 verification) ───────────────────────────────────────────────
async function main(): Promise<void> {

  // Verify tool implementations work with 3 safe API calls

  console.log("\n━━━ STEP 2a: Reset game (fresh state) ━━━");
  const resetResult = await resetGame();
  console.log(JSON.stringify(resetResult, null, 2));
  console.log(resetResult.code !== undefined ? "[OK] Reset successful" : "[FAIL] Reset failed");

  console.log("\n━━━ STEP 2b: Fetch action costs ━━━");
  const costResult = await getActionCost();
  console.log(JSON.stringify(costResult, null, 2));

  console.log("\n━━━ STEP 2c: Find all B3 tiles (tallest blocks = priority target) ━━━");
  const b3Result = await searchSymbol("B3");
  console.log(JSON.stringify(b3Result, null, 2));

  console.log("\n━━━ STEP 2 — Verification ━━━");
  console.log(`[OK] ${tools.length} tool definitions ready for LLM`);
  console.log("[OK] resetGame, getActionCost, searchSymbol tools verified");
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
