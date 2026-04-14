// ─── Imports ────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ────────────────────────────────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ─────────────────────────────────────────────────────────────────
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) { console.error("[config] Missing AI_DEVS_KEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB = "https://hub.ag3nts.org";
const MODEL = "openai/gpt-4.1-mini";

// ─── OpenAI client (OpenRouter) ──────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ───────────────────────────────────────────────────────────────────
interface ColumnInfo {
  column: number;
  yourRow: number;
  stoneRow: number;
  freeRows: number[];
}

interface GameResponse {
  code: number;
  message: string;
  player: { row: number; col: number };
  base: { row: number; col: number };
  currentColumn: ColumnInfo;
}

interface GameState {
  currentRow: number;
  currentCol: number;
  targetRow: number;
  currentColStoneRow: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 5, baseDelayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isLast = attempt === retries;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[retry] attempt ${attempt + 1} failed: ${msg}`);
      if (isLast) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw new Error("unreachable");
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────
async function askLLM(systemPrompt: string, userContent: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  return response.choices[0].message.content?.trim() ?? "";
}

// ─── Frequency Scanner ────────────────────────────────────────────────────────
interface ScannerThreat {
  frequency: number;
  detectionCode: string;
}

async function checkFrequencyScanner(): Promise<ScannerThreat | null> {
  return withRetry(async () => {
    const res = await fetch(`${HUB}/api/frequencyScanner?key=${AI_DEVS_KEY}`);
    const text = await res.text();
    console.log("[scanner] Raw response:", text.slice(0, 200));

    // HTML response = transient server error — retry
    if (text.trimStart().startsWith("<")) {
      throw new Error("Scanner returned HTML error page — will retry");
    }

    // Always use LLM to interpret the (potentially corrupted) scanner response.
    // The response is either "all clear" OR a threat containing frequency + detectionCode.
    const interpreted = await askLLM(
      `You are interpreting a corrupted radar scanner message.
The message is either:
  A) Saying the area is clear / safe (no threat)
  B) Reporting a radar threat with a numeric frequency and a detectionCode string

Respond with ONLY valid JSON in one of these two shapes:
  { "clear": true }
  { "clear": false, "frequency": <number>, "detectionCode": "<string>" }

No explanation, no markdown — just the JSON.`,
      text
    );
    console.log("[scanner] LLM interpretation:", interpreted);

    const result = JSON.parse(interpreted) as { clear: boolean; frequency?: number; detectionCode?: string };

    if (result.clear) {
      console.log("[scanner] LLM says: Clear — no threat.");
      return null;
    }

    const frequency = Number(result.frequency);
    const detectionCode = String(result.detectionCode ?? "");
    if (!frequency || !detectionCode) throw new Error(`LLM extraction incomplete: ${interpreted}`);

    console.log(`[scanner] THREAT detected — frequency=${frequency}, detectionCode=${detectionCode}`);
    return { frequency, detectionCode };
  });
}

async function disarmTrap(threat: ScannerThreat): Promise<void> {
  const disarmHash = createHash("sha1").update(threat.detectionCode + "disarm").digest("hex");
  console.log(`[disarm] SHA1("${threat.detectionCode}disarm") = ${disarmHash}`);

  await withRetry(async () => {
    const res = await fetch(`${HUB}/api/frequencyScanner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: AI_DEVS_KEY,
        frequency: threat.frequency,
        disarmHash,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    console.log("[disarm] Response:", JSON.stringify(data));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

// ─── Radio hint ───────────────────────────────────────────────────────────────
type StoneDirection = "ahead" | "left" | "right";

async function getRadioHint(): Promise<StoneDirection> {
  return withRetry(async () => {
    const res = await fetch(`${HUB}/api/getmessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

    const hint = String(data.hint ?? "");
    console.log("[hint] Raw hint:", hint);

    // LLM interprets the hint — possibly nautical/archaic language
    const direction = await askLLM(
      `You are navigating a rocket on a 3-row grid. A radio hint describes where the rock is in the NEXT column relative to your current position.
Interpret the hint and respond with ONLY one word:
  "ahead"  — rock is directly in front (same row)
  "left"   — rock is to the upper-left (lower row number)
  "right"  — rock is to the lower-right (higher row number)

Examples of nautical/directional language:
  "port" = left, "starboard" = right, "bow" / "fore" = ahead
  "to your left" = left, "to your right" = right, "straight ahead" = ahead

Respond with ONLY one word: ahead, left, or right.`,
      hint
    );

    const normalized = direction.toLowerCase().trim() as StoneDirection;
    if (!["ahead", "left", "right"].includes(normalized)) {
      throw new Error(`LLM returned unexpected direction: "${direction}"`);
    }

    console.log(`[hint] Stone is: ${normalized}`);
    return normalized;
  });
}

// ─── Move decision ───────────────────────────────────────────────────────────
type MoveCommand = "go" | "left" | "right";

function chooseMove(
  currentRow: number,
  currentColStoneRow: number,
  stoneDirection: StoneDirection,
  targetRow: number,
): MoveCommand {
  // Stone in next column (from hint)
  const nextStoneRow =
    stoneDirection === "ahead" ? currentRow :
    stoneDirection === "left"  ? currentRow - 1 :
    currentRow + 1;

  // Build list of safe moves
  const candidates: MoveCommand[] = (["go", "left", "right"] as MoveCommand[]).filter((cmd) => {
    const newRow =
      cmd === "go"    ? currentRow :
      cmd === "left"  ? currentRow - 1 :
      currentRow + 1;

    // Must stay within grid bounds
    if (newRow < 1 || newRow > 3) return false;
    // Must not land on the stone in the next column
    if (newRow === nextStoneRow) return false;
    // Diagonal moves (left/right) cannot "squeeze" past a stone in the current column.
    // E.g. moving left (up) is blocked if current column has a stone directly above us.
    if (cmd === "left"  && currentColStoneRow === currentRow - 1) return false;
    if (cmd === "right" && currentColStoneRow === currentRow + 1) return false;
    return true;
  });

  if (candidates.length === 0) {
    throw new Error(`No safe move! currentRow=${currentRow}, stoneDirection=${stoneDirection}`);
  }

  // Among safe moves prefer the one that brings us closer to targetRow
  candidates.sort((a, b) => {
    const rowA = a === "go" ? currentRow : a === "left" ? currentRow - 1 : currentRow + 1;
    const rowB = b === "go" ? currentRow : b === "left" ? currentRow - 1 : currentRow + 1;
    return Math.abs(rowA - targetRow) - Math.abs(rowB - targetRow);
  });

  const chosen = candidates[0];
  console.log(`[move] row=${currentRow}, curStone=${currentColStoneRow}, nextStone=${stoneDirection}(row ${nextStoneRow}), target=${targetRow} → candidates=[${candidates}] → ${chosen}`);
  return chosen;
}

// ─── Game API ─────────────────────────────────────────────────────────────────
class CrashError extends Error {
  constructor(reason: string) {
    super(`Rocket crashed: ${reason}`);
    this.name = "CrashError";
  }
}

async function sendCommand(command: string): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const res = await fetch(`${HUB}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "goingthere", answer: { command } }),
    });
    const data = await res.json() as Record<string, unknown>;

    // Crash is a game state, not a retryable error — throw special error
    if (data.crashed === true) {
      throw new CrashError(String(data.crashReason ?? "unknown"));
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    return data;
  });
}

async function startGame(): Promise<GameState> {
  console.log("\n━━━ STEP 2: Start game ━━━");
  const raw = await sendCommand("start");
  const data = raw as unknown as GameResponse;

  console.log("[start] Raw response:", JSON.stringify(data, null, 2));
  console.log("[start] message:", data.message);
  console.log(`[start] My position: col=${data.player.col}, row=${data.player.row}`);
  console.log(`[start] Target: col=${data.base.col}, row=${data.base.row}`);
  console.log(`[start] Current column — stone at row ${data.currentColumn.stoneRow}, free rows: [${data.currentColumn.freeRows}]`);

  return {
    currentRow: data.player.row,
    currentCol: data.player.col,
    targetRow: data.base.row,
    currentColStoneRow: data.currentColumn.stoneRow,
  };
}

// ─── Game loop (one full attempt) ────────────────────────────────────────────
// Returns true if flag found, false if crashed (caller restarts).
async function runAttempt(attempt: number): Promise<boolean> {
  const state = await startGame();
  console.log(`\n[attempt ${attempt}] Game state:`, state);

  for (let move = 1; move <= 11; move++) {
    console.log(`\n━━━ ATTEMPT ${attempt} — MOVE ${move}/11 — col=${state.currentCol}, row=${state.currentRow} ━━━`);

    // 3a: Check frequency scanner
    const threat = await checkFrequencyScanner();

    // 3b: Disarm if threatened
    if (threat) {
      console.log("[loop] Threat detected — disarming...");
      await disarmTrap(threat);
      const recheck = await checkFrequencyScanner();
      if (recheck !== null) throw new Error("Trap still active after disarm attempt!");
      console.log("[loop] Trap disarmed ✓");
    }

    // 3c+3d: Get radio hint and interpret direction
    const stoneDirection = await getRadioHint();

    // 3e: Choose and execute move
    const command = chooseMove(state.currentRow, state.currentColStoneRow, stoneDirection, state.targetRow);
    console.log(`[loop] Executing: ${command}`);

    let raw: Record<string, unknown>;
    try {
      raw = await sendCommand(command);
    } catch (err) {
      if (err instanceof CrashError) {
        console.log(`[loop] CRASHED (${err.message}) — will restart game.`);
        return false;
      }
      throw err;
    }

    console.log("[loop] Response:", JSON.stringify(raw));

    // Check for flag
    const flagMatch = JSON.stringify(raw).match(/\{FLG:[^}]+\}/);
    if (flagMatch) {
      console.log(`\n[loop] *** FLAG FOUND: ${flagMatch[0]} ***`);
      return true;
    }

    // Update state from response
    const resp = raw as unknown as GameResponse;
    if (resp.player) {
      state.currentRow = resp.player.row;
      state.currentCol = resp.player.col;
      state.currentColStoneRow = resp.currentColumn.stoneRow;
      console.log(`[loop] New position: col=${state.currentCol}, row=${state.currentRow}, colStone=${state.currentColStoneRow}`);
    }

    if (state.currentCol === 12) {
      console.log("[loop] Reached col 12. Full response:", JSON.stringify(raw, null, 2));
      return true;
    }
  }

  return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("[setup] AI_DEVS_KEY loaded:", AI_DEVS_KEY.slice(0, 6) + "...");
  console.log("[setup] OPENROUTER_KEY loaded:", OPENROUTER_KEY.slice(0, 6) + "...");

  const MAX_ATTEMPTS = 20;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`ATTEMPT ${attempt}/${MAX_ATTEMPTS}`);
    console.log("═".repeat(60));

    const success = await runAttempt(attempt);
    if (success) return;

    console.log(`[main] Attempt ${attempt} failed — retrying...`);
  }

  throw new Error(`Did not reach base after ${MAX_ATTEMPTS} attempts`);
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
