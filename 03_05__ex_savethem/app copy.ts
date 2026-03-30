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
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) {
  console.error("[config] Missing AI_DEVS_KEY");
  process.exit(1);
}

const HUB = "https://hub.ag3nts.org";
const TOOLSEARCH_URL = `${HUB}/api/toolsearch`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface ToolSearchResponse {
  code: number;
  message: string;
  query: string;
  tools: ToolSearchResult[];
}

interface ToolSearchResult {
  url: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function toolSearch(query: string): Promise<ToolSearchResult[]> {
  console.log(`[toolsearch] query: "${query}"`);
  const res = await fetch(TOOLSEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, query }),
  });
  if (!res.ok) throw new Error(`toolsearch HTTP ${res.status}`);
  const data = await res.json() as ToolSearchResponse;
  console.log(`[toolsearch] raw response:`, JSON.stringify(data, null, 2));
  return data.tools;
}

// ─── Tool caller ──────────────────────────────────────────────────────────────
async function callTool(path: string, query: string): Promise<unknown> {
  console.log(`[tool] POST ${path} query="${query}"`);
  const res = await fetch(`${HUB}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, query }),
  });
  if (!res.ok) throw new Error(`tool ${path} HTTP ${res.status}`);
  const data = await res.json();
  console.log(`[tool] response:`, JSON.stringify(data, null, 2));
  return data;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Vehicle = "rocket" | "car" | "horse" | "walk";
type Direction = "up" | "down" | "left" | "right";
type Move = Direction | "dismount";

interface VehicleStats {
  fuelPerMove: number;
  foodPerMove: number;
  canCrossWater: boolean;
}

interface PathState {
  row: number;
  col: number;
  vehicle: Vehicle;
  fuelUsed: number;
  foodUsed: number;
  moves: Move[];
}

// ─── Terrain & vehicle rules ───────────────────────────────────────────────────
const VEHICLES: Record<Vehicle, VehicleStats> = {
  rocket: { fuelPerMove: 1.0, foodPerMove: 0.1, canCrossWater: false },
  car:    { fuelPerMove: 0.7, foodPerMove: 1.0, canCrossWater: false },
  horse:  { fuelPerMove: 0.0, foodPerMove: 1.6, canCrossWater: true  },
  walk:   { fuelPerMove: 0.0, foodPerMove: 2.5, canCrossWater: true  },
};

const FUEL_BUDGET = 10;
const FOOD_BUDGET = 10;
const TREE_EXTRA_FUEL = 0.2; // extra fuel for powered vehicles on T tile

function isWater(cell: string): boolean  { return cell === "W"; }
function isRock(cell: string): boolean   { return cell === "R"; }
function isTree(cell: string): boolean   { return cell === "T"; }

// ─── Pathfinding (Dijkstra / BFS) ────────────────────────────────────────────
function findPath(
  map: string[][],
  startVehicle: Vehicle
): PathState | null {
  const ROWS = map.length;
  const COLS = map[0].length;

  let startRow = -1, startCol = -1, goalRow = -1, goalCol = -1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (map[r][c] === "S") { startRow = r; startCol = c; }
      if (map[r][c] === "G") { goalRow  = r; goalCol  = c; }
    }
  }

  const DIRS: { dir: Direction; dr: number; dc: number }[] = [
    { dir: "up",    dr: -1, dc:  0 },
    { dir: "down",  dr:  1, dc:  0 },
    { dir: "left",  dr:  0, dc: -1 },
    { dir: "right", dr:  0, dc:  1 },
  ];

  // BFS ordered by number of moves (shortest path first)
  // State key: row,col,vehicle
  const visited = new Map<string, number>(); // key → moves count when first visited
  const queue: PathState[] = [];

  queue.push({
    row: startRow, col: startCol,
    vehicle: startVehicle,
    fuelUsed: 0, foodUsed: 0,
    moves: [],
  });

  while (queue.length > 0) {
    // Sort by moves length (BFS approximation — use priority queue for full Dijkstra)
    queue.sort((a, b) => a.moves.length - b.moves.length);
    const state = queue.shift()!;
    const { row, col, vehicle, fuelUsed, foodUsed, moves } = state;

    // Check goal
    if (row === goalRow && col === goalCol) return state;

    const stateKey = `${row},${col},${vehicle}`;
    const prevMoves = visited.get(stateKey);
    if (prevMoves !== undefined && prevMoves <= moves.length) continue;
    visited.set(stateKey, moves.length);

    const stats = VEHICLES[vehicle];

    // Option 1: move in a direction
    for (const { dir, dr, dc } of DIRS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;

      const cell = map[nr][nc];
      if (isRock(cell)) continue;
      if (isWater(cell) && !stats.canCrossWater) continue;

      const extraFuel = isTree(cell) && stats.fuelPerMove > 0 ? TREE_EXTRA_FUEL : 0;
      const newFuel = fuelUsed + stats.fuelPerMove + extraFuel;
      const newFood = foodUsed + stats.foodPerMove;

      if (newFuel > FUEL_BUDGET || newFood > FOOD_BUDGET) continue;

      queue.push({
        row: nr, col: nc, vehicle,
        fuelUsed: newFuel, foodUsed: newFood,
        moves: [...moves, dir],
      });
    }

    // Option 2: dismount (switch to walk), only if not already walking
    if (vehicle !== "walk") {
      const walkKey = `${row},${col},walk`;
      const prev = visited.get(walkKey);
      if (prev === undefined || prev > moves.length) {
        queue.push({
          row, col, vehicle: "walk",
          fuelUsed, foodUsed,
          moves: [...moves, "dismount"],
        });
      }
    }
  }

  return null; // no path found
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ STEP 6+7+8: build map & find optimal path ━━━");

  // --- Step 6: use hardcoded map from API (step 3 result) ---
  const mapText = "........WW\n.......WW.\n.T....WW..\n......W...\n..T...W.G.\n....R.W...\n...RR.WW..\nSR.....W..\n......WW..\n.....WW...";
  const map: string[][] = mapText.split("\n").map((row) => row.split(""));

  console.log("\n[step6] Map (10x10):");
  map.forEach((row, i) => console.log(`  row${i}: ${row.join(" ")}`));

  // Find S and G
  let startRow = -1, startCol = -1, goalRow = -1, goalCol = -1;
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[0].length; c++) {
      if (map[r][c] === "S") { startRow = r; startCol = c; }
      if (map[r][c] === "G") { goalRow  = r; goalCol  = c; }
    }
  }
  console.log(`\n[step6] START=(${startRow},${startCol})  GOAL=(${goalRow},${goalCol})`);

  // --- Step 7: try all starting vehicles ---
  console.log("\n[step7] Running pathfinding for each vehicle...");
  const startVehicles: Vehicle[] = ["rocket", "car", "horse", "walk"];

  const results: { vehicle: Vehicle; path: PathState }[] = [];

  for (const v of startVehicles) {
    const path = findPath(map, v);
    if (path) {
      console.log(`  [✓] ${v}: ${path.moves.length} moves | fuel=${path.fuelUsed.toFixed(1)} food=${path.foodUsed.toFixed(1)}`);
      console.log(`      moves: ${path.moves.join(" → ")}`);
      results.push({ vehicle: v, path });
    } else {
      console.log(`  [✗] ${v}: no valid path within budget`);
    }
  }

  // --- Step 8: pick optimal (most remaining resources = safest) ---
  if (results.length === 0) {
    console.error("\n[step8] No valid path found for any vehicle!");
    return;
  }

  const best = results.reduce((a, b) => {
    const marginA = (FUEL_BUDGET - a.path.fuelUsed) + (FOOD_BUDGET - a.path.foodUsed);
    const marginB = (FUEL_BUDGET - b.path.fuelUsed) + (FOOD_BUDGET - b.path.foodUsed);
    return marginA > marginB ? a : b;
  });

  console.log(`\n[step8] Best vehicle: ${best.vehicle}`);
  console.log(`[step8] Moves (${best.path.moves.length}): ${best.path.moves.join(", ")}`);
  console.log(`[step8] Fuel used: ${best.path.fuelUsed.toFixed(2)} / ${FUEL_BUDGET}`);
  console.log(`[step8] Food used: ${best.path.foodUsed.toFixed(2)} / ${FOOD_BUDGET}`);

  const answer = [best.vehicle, ...best.path.moves];
  console.log(`\n[step8] Answer array:`, JSON.stringify(answer));

  // --- Step 9: submit ---
  console.log("\n━━━ STEP 9: submit answer ━━━");
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "savethem", answer }),
  });
  const data = await res.json();
  console.log("[step9] Hub response:", JSON.stringify(data, null, 2));

  const flagMatch = JSON.stringify(data).match(/\{FLG:[^}]+\}/);
  if (flagMatch) {
    console.log(`\n[step9] FLAG FOUND: ${flagMatch[0]}`);
  }
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
