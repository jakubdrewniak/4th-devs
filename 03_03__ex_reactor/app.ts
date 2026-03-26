import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import OpenAI from "openai";

// --- Load .env from project root ---

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");
if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// --- Config ---

const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!AI_DEVS_KEY) { console.error("[config] Missing AI_DEVS_KEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const VERIFY_URL = "https://hub.ag3nts.org/verify";
const MODEL = "anthropic/claude-sonnet-4-6";
const MAX_TURNS = 60;

// --- OpenAI client (via OpenRouter) ---

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// --- Types ---

type Block = {
  col: number;
  top_row: number;
  bottom_row: number;
  direction: "up" | "down";
};

type BoardState = {
  code: number;
  message: string;
  board: string[][];
  player: { col: number; row: number };
  goal: { col: number; row: number };
  blocks: Block[];
  reached_goal: boolean;
};

type Command = "start" | "left" | "right" | "wait" | "reset";

// --- API layer ---

async function sendCommand(command: Command): Promise<BoardState> {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: AI_DEVS_KEY,
      task: "reactor",
      answer: { command },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json() as BoardState;
  return data;
}

function renderBoard(state: BoardState): string {
  return state.board
    .map((row, i) => `row ${i + 1}: ${row.join(" ")}`)
    .join("\n");
}

// --- System prompt ---

const SYSTEM_PROMPT = `You control a robot navigating a 7-column × 5-row reactor board.
The robot always stays on row 5 (the bottom row) and can only move left or right.
Goal: reach column 7 (marked G on the board).

COMMANDS:
- right: robot moves one column to the right (col+1)
- left:  robot moves one column to the left (col-1)
- wait:  robot stays in place

BLOCK MOVEMENT — happens after EVERY command (including wait):
- Each block occupies exactly 2 rows in a single column (top_row and bottom_row)
- After each command, every block moves 1 row in its current direction
- direction "down": top_row += 1, bottom_row += 1
- direction "up":   top_row -= 1, bottom_row -= 1
- When bottom_row would exceed 5, the block reverses direction to "up" instead
- When top_row would go below 1, the block reverses direction to "down" instead

DANGER: A block crushes the robot if they are in the same column AND the block's bottom_row = 5.

YOUR TASK — for each turn:
1. Simulate where ALL blocks will be AFTER the command executes (blocks always move by 1 step)
2. Check if the robot's resulting column will be safe (no block with bottom_row = 5 there)
3. Choose the command using this priority:
   - "right" if column (player.col + 1) will be safe after blocks move
   - "wait"  if moving right is unsafe but staying in current column will be safe
   - "left"  if both right and wait are unsafe (escape backwards)

IMPORTANT: Always simulate the NEXT state of blocks before deciding. A block with bottom_row=4 and direction="down" will be at bottom_row=5 after the command — deadly!

Think step by step briefly, then on the very last line write ONLY the command word: right, left, or wait`;

// --- LLM decision ---

async function decideCommand(state: BoardState): Promise<Command> {
  const userMessage = `Current board state:
${renderBoard(state)}

Player position: col=${state.player.col}, row=${state.player.row}
Goal position:   col=${state.goal.col}, row=${state.goal.row}

Blocks:
${state.blocks.map(b =>
  `  col=${b.col}: top_row=${b.top_row}, bottom_row=${b.bottom_row}, direction=${b.direction}`
).join("\n")}

What is your next command?`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 400,
    temperature: 0,
  });

  const raw = response.choices[0].message.content?.trim().toLowerCase() ?? "";
  const matches = [...raw.matchAll(/right|left|wait/g)];
  const command = (matches.length > 0 ? matches[matches.length - 1][0] : "wait") as Command;

  console.log(`[llm] Raw response: "${raw}" → command: ${command}`);
  return command;
}

// --- Agent loop ---

async function runAgent(): Promise<void> {
  console.log("[agent] Sending start...");
  let state = await sendCommand("start");

  console.log("[agent] Initial board:\n" + renderBoard(state));
  console.log(`[agent] Player: col=${state.player.col} | Goal: col=${state.goal.col}`);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (state.reached_goal) {
      console.log(`\n[agent] SUCCESS — reached goal in ${turn - 1} turns!`);
      return;
    }

    console.log(`\n--- turn ${turn}/${MAX_TURNS} | player col=${state.player.col} ---`);

    const command = await decideCommand(state);
    state = await sendCommand(command);

    console.log("[board]\n" + renderBoard(state));
    console.log(`[state] reached_goal=${state.reached_goal} | player col=${state.player.col}`);
  }

  if (state.reached_goal) {
    console.log("[agent] SUCCESS — reached goal!");
  } else {
    console.log("[agent] Max turns reached without success.");
  }
}

// --- Main ---

async function main(): Promise<void> {
  await runAgent();
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
