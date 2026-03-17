import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
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

const HUB = "https://hub.ag3nts.org";
const MODEL_VISION = "google/gemini-3-flash-preview";
const MODEL_AGENT = "openai/gpt-4.1-mini";

const CURRENT_BOARD_URL = `${HUB}/data/${AI_DEVS_KEY}/electricity.png`;
const SOLVED_IMAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "solved_electricity.png");

console.log("[config] Setup complete ✓");
console.log("[config] Models: vision=" + MODEL_VISION + " agent=" + MODEL_AGENT);

// ─── OpenAI client (OpenRouter) ───────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Image helpers ────────────────────────────────────────────────────────────

function readLocalImageAsBase64(filePath: string): { base64: string; mimeType: string } {
  const buffer = readFileSync(filePath);
  return { base64: buffer.toString("base64"), mimeType: "image/png" };
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") ?? "image/png";
  return { base64: Buffer.from(buffer).toString("base64"), mimeType };
}

// ─── Tool: analyze_boards ─────────────────────────────────────────────────────
// Sends both images (solved target + current state) to a vision model.
// Returns a rotation plan: for each cell AxB, how many 90° clockwise rotations needed.

async function analyzeBoards(): Promise<Record<string, number>> {
  console.log("\n[analyze_boards] Reading solved image from disk...");
  const solved = readLocalImageAsBase64(SOLVED_IMAGE_PATH);
  console.log("[analyze_boards] Solved image loaded, size:", solved.base64.length, "chars");

  console.log("[analyze_boards] Fetching current board from hub...");
  const current = await fetchImageAsBase64(CURRENT_BOARD_URL);
  console.log("[analyze_boards] Current board loaded, size:", current.base64.length, "chars");

  console.log("[analyze_boards] Sending both images to vision model:", MODEL_VISION);

  const response = await openai.chat.completions.create({
    model: MODEL_VISION,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are analyzing a 3x3 electrical cable puzzle.

The board has 9 cells addressed as AxB where A=row (1-3, top to bottom) and B=column (1-3, left to right):
1x1 | 1x2 | 1x3
2x1 | 2x2 | 2x3
3x1 | 3x2 | 3x3

Each cell contains cable connectors. The only allowed operation is rotating a cell 90° clockwise.

I'm sending you TWO images:
1. FIRST IMAGE = the TARGET (solved) state
2. SECOND IMAGE = the CURRENT state of the board

For each of the 9 cells, determine how many 90° clockwise rotations are needed to transform the CURRENT state into the TARGET state.
Possible values: 0, 1, 2, or 3.

Respond ONLY with a JSON object like this (no markdown, no explanation):
{
  "1x1": 0,
  "1x2": 1,
  "1x3": 2,
  "2x1": 0,
  "2x2": 3,
  "2x3": 1,
  "3x1": 0,
  "3x2": 2,
  "3x3": 0
}`,
          },
          {
            type: "image_url",
            image_url: { url: `data:${solved.mimeType};base64,${solved.base64}` },
          },
          {
            type: "image_url",
            image_url: { url: `data:${current.mimeType};base64,${current.base64}` },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  console.log("[analyze_boards] Vision model raw response:\n", raw);

  const jsonStr = raw.replace(/```(?:json)?\s*/g, "").trim();
  const plan: Record<string, number> = JSON.parse(jsonStr);
  console.log("[analyze_boards] Parsed rotation plan:", plan);
  return plan;
}

// ─── Tool: rotate_cell ────────────────────────────────────────────────────────
// Sends one 90° clockwise rotation for the given cell (e.g. "2x3") to the hub.
// Returns the API response. Detects flag in response.

async function rotateCell(cell: string): Promise<{ raw: unknown; flag: string | null }> {
  console.log(`[rotate_cell] Rotating cell ${cell}...`);

  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "electricity", answer: { rotate: cell } }),
  });

  const data = await res.json();
  console.log(`[rotate_cell] Response for ${cell}:`, JSON.stringify(data));

  const responseStr = JSON.stringify(data);
  const flagMatch = responseStr.match(/\{FLG:[^}]+\}/);

  return { raw: data, flag: flagMatch ? flagMatch[0] : null };
}

// ─── Tool: reset_board ────────────────────────────────────────────────────────
// Resets the board to its initial state.

async function resetBoard(): Promise<void> {
  console.log("[reset_board] Resetting board...");
  const res = await fetch(`${CURRENT_BOARD_URL}?reset=1`);
  console.log("[reset_board] Reset response status:", res.status);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n[main] Step 1: Analyze boards");
  const plan = await analyzeBoards();

  console.log("\n[main] Step 2: Execute rotations");
  for (const [cell, rotations] of Object.entries(plan)) {
    if (rotations === 0) {
      console.log(`[main] Cell ${cell}: no rotation needed, skipping`);
      continue;
    }
    for (let i = 0; i < rotations; i++) {
      const { flag } = await rotateCell(cell);
      if (flag) {
        console.log(`\n[main] FLAG FOUND: ${flag}`);
        return;
      }
    }
  }

  console.log("\n[main] All rotations sent. Waiting for flag...");
}

main().catch((err) => { console.error("[error]", err.message); process.exit(1); });
