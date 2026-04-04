// Opcja A — Ogólny prompt: Dajemy agentowi zasady gry, mapę i B3 locations, ale pozwalamy mu samemu wymyślić plan. 
// Bardziej autonomiczny, ale ryzyko że nie zoptymalizuje punktów.

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
const MAX_AGENT_STEPS = 40;

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
      description: "Returns all current units (scouts and transporters) with their hash IDs and positions on the map. Cost: 0 pts. Call this after creating units or after moves to learn unit IDs and current positions.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "createUnit",
      description: "Creates a new unit at the next available spawn slot (A6→D6). Cost: scout=5pts, transporter=5+5*passengers pts.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["scout", "transporter"], description: "Unit type to create" },
          passengers: { type: "number", description: "Number of scouts aboard (1-4). Required only for transporter." },
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
      description: "Moves a unit to the target coordinate. Transporters follow road-only paths (1 pt/field). Scouts take shortest orthogonal path through any walkable terrain (7 pt/field). The API computes the path automatically.",
      parameters: {
        type: "object",
        properties: {
          unitHash: { type: "string", description: "Hash ID of the unit to move" },
          where: { type: "string", description: "Target coordinate, e.g. 'D9', 'F1'" },
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
      description: "Scout inspects the field it currently stands on. Cost: 1 pt. After inspecting, call getLogs to read the inspection results.",
      parameters: {
        type: "object",
        properties: {
          scoutHash: { type: "string", description: "Hash ID of the scout" },
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
      description: "Dismounts N scouts from a transporter onto free adjacent tiles. Cost: 0 pts. Transporter must be stopped at its destination first.",
      parameters: {
        type: "object",
        properties: {
          transporterHash: { type: "string", description: "Hash ID of the transporter" },
          passengers: { type: "number", description: "Number of scouts to dismount (1-4)" },
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
      description: "Returns all inspection log entries. Cost: 0 pts. Call this after inspect to see what the scout found. If a log says a human was found, immediately call callHelicopter with that coordinate.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "callHelicopter",
      description: "Calls the evacuation helicopter to the given coordinate. Cost: 0 pts. ONLY call after a scout confirmed finding a human at that location via inspect+getLogs.",
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

// ─── Tool dispatcher ──────────────────────────────────────────────────────────
async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  let result: HubResponse;

  switch (name) {
    case "getObjects":
      result = await getObjects();
      break;
    case "createUnit":
      result = await createUnit(
        args.type as "scout" | "transporter",
        args.passengers as number | undefined,
      );
      break;
    case "moveUnit":
      result = await moveUnit(args.unitHash as string, args.where as string);
      break;
    case "inspectField":
      result = await inspectField(args.scoutHash as string);
      break;
    case "dismountScouts":
      result = await dismountScouts(args.transporterHash as string, args.passengers as number);
      break;
    case "getLogs":
      result = await getLogs();
      break;
    case "callHelicopter":
      result = await callHelicopter(args.destination as string);
      break;
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  return JSON.stringify(result);
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt(b3Positions: string[]): string {
  return `You are a tactical field commander running a search-and-rescue operation in the ruined city of Domatowo.

## OBJECTIVE
Find a partisan hiding in the ruins and call an evacuation helicopter to his location.

## INTERCEPTED RADIO MESSAGE FROM THE PARTISAN
"I survived. Bombs destroyed the city. Soldiers were here, looking for resources, took the oil. Now it's empty. I have a weapon, I'm wounded. I hid in one of the tallest blocks. I have no food. Help."

KEY CLUE: The partisan is hiding in one of the TALLEST blocks. On this map, the tallest blocks are B3 (Blok 3-piętrowy / 3-story block).

## MAP (11×11 grid, columns A-K, rows 1-11)

     A    B    C    D    E    F    G    H    I    J    K
1  [ DR ] [UL ] [UL ] [UL ] [   ] [B3 ] [B3 ] [DR ] [   ] [PK ] [PK ]
2  [ DR ] [DR ] [   ] [UL ] [UL ] [B3 ] [B3 ] [DR ] [UL ] [PK ] [PK ]
3  [    ] [   ] [   ] [UL ] [PK ] [   ] [   ] [DR ] [UL ] [   ] [   ]
4  [ B1 ] [B1 ] [   ] [UL ] [PK ] [SZ ] [SZ ] [SZ ] [UL ] [BS ] [BS ]
5  [ B1 ] [B1 ] [   ] [UL ] [PK ] [SZ ] [SZ ] [SZ ] [UL ] [BS ] [BS ]
6  [ UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [   ]
7  [ B2 ] [B2 ] [   ] [UL ] [   ] [KS ] [KS ] [KS ] [   ] [DR ] [   ]
8  [ B2 ] [B2 ] [   ] [UL ] [   ] [KS ] [KS ] [KS ] [   ] [DR ] [   ]
9  [    ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [UL ] [   ]
10 [ B3 ] [B3 ] [B3 ] [   ] [DR ] [   ] [   ] [B3 ] [B3 ] [DR ] [   ]
11 [ B3 ] [B3 ] [B3 ] [   ] [DR ] [   ] [   ] [B3 ] [B3 ] [DR ] [   ]

Legend: UL=Road, DR=Trees, B1/B2/B3=Blocks(1/2/3 floors), SZ=School, KS=Church, PK=Parking, BS=Field, (empty)=Open space

## B3 TILE POSITIONS (search targets)
${b3Positions.join(", ")}

Three clusters:
- North cluster: F1, G1, F2, G2
- South-west cluster: A10, B10, C10, A11, B11, C11
- South-east cluster: H10, I10, H11, I11

## ROAD NETWORK (transporters can ONLY move on UL tiles)
- Row 6: A6–J6 (main road, SPAWN ROW)
- Row 9: B9–J9
- Column D: D1–D9 (full vertical)
- Column I: I2–I6 and I9 (gap at I7–I8!)
- Row 1: B1–D1
- Row 2: D2–E2, I2

## UNITS & SPAWN
- Spawn slots: A6, B6, C6, D6 (on the main road)
- Max 4 transporters, max 8 scouts total
- Budget: 300 action points for the entire operation

## ACTION COSTS
- Create scout: 5 pts
- Create transporter: 5 + (passengers × 5) pts
- Move transporter: 1 pt per field (road only, cheap!)
- Move scout: 7 pts per field (any terrain, expensive!)
- Inspect: 1 pt
- Dismount scouts from transporter: 0 pts
- getLogs / getObjects / callHelicopter: 0 pts

## RULES
1. Transporters can ONLY drive on road (UL) tiles. Scouts walk through any terrain.
2. Scout movement is 7× more expensive than transporter movement. Always prefer transporting scouts close to the target before dismounting them.
3. After inspecting, always call getLogs to check the result.
4. When getLogs shows that a human/partisan was found at a coordinate, IMMEDIATELY call callHelicopter with that coordinate.
5. You must be efficient with action points. Plan your routes carefully before acting.
6. After creating units, call getObjects to learn their hash IDs — you need IDs for move/inspect/dismount.
7. You can call multiple tools in sequence within one turn to be efficient.

## YOUR APPROACH
Think step by step. Plan your route, then execute it. The partisan is in ONE of the ${b3Positions.length} B3 tiles (randomly placed each game). You need to systematically inspect B3 tiles until you find him.`;
}

// ─── Flag detection ───────────────────────────────────────────────────────────
const FLAG_REGEX = /\{\{FLG:.*?\}\}/;

function extractFlag(text: string): string | null {
  const match = text.match(FLAG_REGEX);
  return match ? match[0] : null;
}

// ─── Agent loop ───────────────────────────────────────────────────────────────
async function runAgent(systemPrompt: string): Promise<string | null> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Begin the rescue operation. Plan your approach, then start executing. Remember: the partisan is in a B3 tile. Be efficient with action points." },
  ];

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    console.log(`\n━━━ Agent step ${step + 1}/${MAX_AGENT_STEPS} ━━━`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      temperature: 0,
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // Log the agent's reasoning
    if (assistantMsg.content) {
      console.log(`[agent] ${assistantMsg.content}`);

      // Check for flag in agent's text
      const flag = extractFlag(assistantMsg.content);
      if (flag) {
        console.log(`\n🏁 FLAG FOUND: ${flag}`);
        return flag;
      }
    }

    // If no tool calls, the agent has finished talking
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      console.log("[agent] No more tool calls — stopping.");
      messages.push(assistantMsg);
      break;
    }

    // Push assistant message with tool_calls to history
    messages.push(assistantMsg);

    // Execute each tool call
    for (const toolCall of assistantMsg.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);
      console.log(`  [tool] ${fnName}(${JSON.stringify(fnArgs)})`);

      const result = await dispatchTool(fnName, fnArgs);
      console.log(`  [result] ${result.substring(0, 300)}${result.length > 300 ? "..." : ""}`);

      // Check for flag in API response
      const flag = extractFlag(result);
      if (flag) {
        console.log(`\n🏁 FLAG FOUND IN API RESPONSE: ${flag}`);
        return flag;
      }

      // Push tool result to history
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {

  // Phase 1: Reset game and gather context
  console.log("━━━ Phase 1: Initializing game ━━━");
  const resetResult = await resetGame();
  console.log(`[reset] ${resetResult.message} (code: ${resetResult.code})`);

  const b3Result = await searchSymbol("B3");
  const b3Positions = ((b3Result.found as Array<{ position: string }>) ?? []).map(f => f.position);
  console.log(`[map] B3 tiles: ${b3Positions.join(", ")} (${b3Positions.length} total)`);

  // Phase 2: Build system prompt and run agent
  console.log("\n━━━ Phase 2: Running agent ━━━");
  const systemPrompt = buildSystemPrompt(b3Positions);
  const flag = await runAgent(systemPrompt);

  // Phase 3: Report result
  console.log("\n━━━ Result ━━━");
  if (flag) {
    console.log(`SUCCESS — Flag: ${flag}`);
  } else {
    console.log("FAIL — Agent did not find the flag within step limit.");
  }
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
