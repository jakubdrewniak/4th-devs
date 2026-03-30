// ─── Imports ────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ────────────────────────────────────────────
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
const MODEL = "openai/gpt-4.1-mini";


// ─── OpenAI client (OpenRouter) ──────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ───────────────────────────────────────────────────────────────────
interface MapResponse {
  code: number;
  cityName: string;
  map: string[][];
  text: string;
}

interface Position {
  row: number;
  col: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseMap(mapData: MapResponse): { grid: string[][]; start: Position; goal: Position } {
  const grid = mapData.map;
  let start: Position | null = null;
  let goal: Position | null = null;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === "S") start = { row, col };
      if (grid[row][col] === "G") goal = { row, col };
    }
  }

  if (!start || !goal) throw new Error("Map missing S or G position");
  return { grid, start, goal };
}

function printMap(grid: string[][], start: Position, goal: Position): void {
  console.log("\n[map]    0123456789");
  grid.forEach((row, i) => {
    const marker = i === start.row ? "← START" : i === goal.row ? "← GOAL " : "";
    console.log(`[map] ${i}: ${row.join("")}  ${marker}`);
  });
  console.log(`[map] S=${JSON.stringify(start)}, G=${JSON.stringify(goal)}`);
}
async function toolSearch(query: string): Promise<unknown> {
  const res = await fetch(`${HUB}/api/toolsearch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, query }),
  });
  if (!res.ok) throw new Error(`toolSearch HTTP ${res.status}`);
  return res.json();
}

async function callTool(endpoint: string, query: string): Promise<unknown> {
  const url = endpoint.startsWith("http") ? endpoint : `${HUB}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, query }),
  });
  const body = await res.text();
  console.log(`[callTool] ${url} → HTTP ${res.status}: ${body}`);
  if (!res.ok) throw new Error(`callTool HTTP ${res.status} (${url})`);
  return JSON.parse(body);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ STEP 3: Fetch map ━━━");

  const mapResult = await callTool("/api/maps", "Skolwin") as MapResponse;
  const { grid, start, goal } = parseMap(mapResult);
  printMap(grid, start, goal);

  console.log("\n━━━ STEP 6: Query books for terrain rules ━━━");
  for (const query of ["terrain movement rules", "what tiles are passable", "rocks trees water obstacles", "map symbols meaning"]) {
    console.log(`\n[books] query: "${query}"`);
    try {
      const result = await callTool("/api/books", query);
      console.log("[books] result:", JSON.stringify(result, null, 2));
    } catch {
      // logged inside callTool
    }
  }
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
