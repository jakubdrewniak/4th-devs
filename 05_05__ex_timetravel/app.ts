// ─── Imports ─────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ─────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ──────────────────────────────────────
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) {
  console.error("[config] Missing AI_DEVS_KEY");
  process.exit(1);
}
if (!OPENROUTER_KEY) {
  console.error("[config] Missing OPENROUTER_API_KEY");
  process.exit(1);
}

const HUB = "https://hub.ag3nts.org";
const VERIFY_URL = `${HUB}/verify`;
const TASK_NAME = "timetravel";
const DOCS_URL = `${HUB}/dane/timetravel.md`;
const LLM_MODEL = "openai/gpt-4.1-mini";

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCS_CACHE = path.join(SCRIPT_DIR, "timetravel.md");

// ─── Types ───────────────────────────────────────
type VerifyAnswer = Record<string, unknown>;

interface VerifyResponse {
  code?: number;
  message?: unknown;
  msg?: unknown;
  note?: string;
  [key: string]: unknown;
}

// ─── Helpers: docs ───────────────────────────────
async function loadDocs(forceRefresh = false): Promise<string> {
  if (!forceRefresh && existsSync(DOCS_CACHE)) {
    const cached = readFileSync(DOCS_CACHE, "utf-8");
    console.log(`[docs] using cached docs (${cached.length} chars) → ${DOCS_CACHE}`);
    return cached;
  }
  console.log(`[docs] fetching ${DOCS_URL} ...`);
  const res = await fetch(DOCS_URL);
  if (!res.ok) throw new Error(`Failed to fetch docs: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(DOCS_CACHE, text, "utf-8");
  console.log(`[docs] fetched & cached (${text.length} chars) → ${DOCS_CACHE}`);
  return text;
}

// ─── Helpers: rules from documentation ──────────
// Rule 1: syncRatio — docs "Wyliczanie wskaźnika temporalnego"
//   weights: day=8, month=12, year=7
//   sum = day*8 + month*12 + year*7
//   n   = sum mod 101   (range 0..100)
//   syncRatio = n / 100 rounded to 2 decimals (API requires 2 decimals, 0..1)
function computeSyncRatio(day: number, month: number, year: number): number {
  const sum = day * 8 + month * 12 + year * 7;
  const n = sum % 101;
  return Math.round(n) / 100;
}

// Rule 2: internalMode — docs "InternalMode"
//   year <  2000           → 1
//   year ∈ [2000, 2150]    → 2
//   year ∈ [2151, 2300]    → 3
//   year >= 2301           → 4
function internalModeFor(year: number): 1 | 2 | 3 | 4 {
  if (year < 2000) return 1;
  if (year <= 2150) return 2;
  if (year <= 2300) return 3;
  return 4;
}

// Rule 3: PWR — docs "Zalecany poziom ochrony" (table, 10 pairs per row)
// Parse lazily on first call; memoize.
let PWR_TABLE: Map<number, number> | null = null;
function buildPwrTable(docs: string): Map<number, number> {
  const map = new Map<number, number>();
  // Rows like: | 1500 | 03 | 1501 | 03 | ... (10 pairs).
  // Strategy: split line by `|`, trim, pair up numeric tokens.
  const lines = docs.split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    // skip header / separator rows (non-numeric)
    if (!/^\d+$/.test(cells[0] ?? "")) continue;
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const year = Number(cells[i]);
      const pwr = Number(cells[i + 1]);
      if (Number.isFinite(year) && Number.isFinite(pwr)) {
        map.set(year, pwr);
      }
    }
  }
  return map;
}
function requiredPwr(year: number, docs: string): number {
  if (!PWR_TABLE) PWR_TABLE = buildPwrTable(docs);
  const v = PWR_TABLE.get(year);
  if (v === undefined) throw new Error(`PWR table has no entry for year=${year}`);
  return v;
}

// Rule 4: tunnel requires battery ≥ 60% — docs "Tunele czasowe"
// Rule 5: jump direction — PT-A = past, PT-B = future; tunnel = both on

// ─── Helpers: LLM (stabilization hint parser) ────
async function extractStabilization(needConfig: string): Promise<number> {
  console.log(`[llm] parsing needConfig hint (${needConfig.length} chars) ...`);
  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Zwracasz TYLKO JSON {\"value\": N}. Z tekstu po polsku wyciągnij finalną, zalecaną wartość liczbową parametru stabilization (liczba całkowita 0-1000). Tekst zawiera liczby zapisane słownie oraz operację matematyczną (dodaj/odejmij/obniż/zwiększ). Wykonaj obliczenie i zwróć wynik.",
      },
      { role: "user", content: needConfig },
    ],
  });
  const content = response.choices[0].message.content ?? "{}";
  console.log(`[llm] ← ${content}`);
  const parsed = JSON.parse(content) as { value?: unknown };
  const value = Number(parsed.value);
  if (!Number.isFinite(value) || value < 0 || value > 1000) {
    throw new Error(`LLM returned invalid stabilization value: ${JSON.stringify(parsed)}`);
  }
  return Math.round(value);
}

// ─── Helpers: CLI interaction ────────────────────
async function waitForEnter(message: string): Promise<void> {
  process.stdout.write(`\n⏸  ${message}\n   press ENTER to continue... `);
  await new Promise<void>((resolve) => {
    const onData = () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
  console.log("");
}

// ─── Helpers: API ────────────────────────────────
type EditableParam = "day" | "month" | "year" | "syncRatio" | "stabilization";

async function callVerify(answer: VerifyAnswer, verbose = true): Promise<VerifyResponse> {
  const body = { apikey: AI_DEVS_KEY, task: TASK_NAME, answer };
  if (verbose) console.log(`[api] → ${JSON.stringify(answer)}`);
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as VerifyResponse;
  if (verbose) console.log(`[api] ← ${JSON.stringify(data, null, 2)}`);

  checkForFlag(data);
  return data;
}

function checkForFlag(data: VerifyResponse): void {
  const flagMatch = JSON.stringify(data).match(/\{\{FLG:[^}]+\}\}|\{FLG:[^}]+\}/);
  if (flagMatch) {
    console.log(`\n[agent] 🏁 FLAG FOUND: ${flagMatch[0]}\n`);
  }
}

const api = {
  help: () => callVerify({ action: "help" }),
  getConfig: () => callVerify({ action: "getConfig" }),
  reset: () => callVerify({ action: "reset" }),
  configure: (param: EditableParam, value: number) =>
    callVerify({ action: "configure", param, value }),
};

// ─── Helpers: jump orchestrator ──────────────────
type JumpDirection = "past" | "future" | "tunnel";

interface JumpTarget {
  label: string;
  day: number;
  month: number;
  year: number;
  direction: JumpDirection;
  skipReset?: boolean; // skip API reset — use when device is already at the right source date
}

function parseBatteryPercent(status: unknown): number | null {
  // status can be "1/3", "60%", "2/3", numeric, etc.
  if (typeof status === "number") return status;
  if (typeof status !== "string") return null;
  const pct = status.match(/(\d+)\s*%/);
  if (pct) return Number(pct[1]);
  const frac = status.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 100);
  const n = Number(status);
  return Number.isFinite(n) ? n : null;
}

async function askYesNo(question: string): Promise<boolean> {
  process.stdout.write(`\n❓ ${question} [y/N]: `);
  return new Promise<boolean>((resolve) => {
    const onData = (buf: Buffer) => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      const ans = buf.toString().trim().toLowerCase();
      resolve(ans === "y" || ans === "yes" || ans === "t" || ans === "tak");
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

function printOperatorInstructions(target: JumpTarget, pwr: number, expectedInternalMode: number): void {
  const ptA = target.direction === "past" || target.direction === "tunnel";
  const ptB = target.direction === "future" || target.direction === "tunnel";
  console.log("\n┌─ OPERATOR UI INSTRUCTIONS ───────────────────────");
  console.log(`│ target:         ${target.label}`);
  console.log(`│ PT-A (past):    ${ptA ? "ON  ✅" : "OFF"}`);
  console.log(`│ PT-B (future):  ${ptB ? "ON  ✅" : "OFF"}`);
  console.log(`│ PWR level:      ${pwr}`);
  console.log(`│ mode switch:    active`);
  console.log(`│ expected internalMode=${expectedInternalMode}, fluxDensity=100`);
  console.log("└──────────────────────────────────────────────────");
}

async function performJump(target: JumpTarget, docs: string): Promise<VerifyResponse> {
  console.log(`\n━━━ JUMP: ${target.label} ━━━`);

  // 1) Pre-check
  console.log("\n[jump] pre-check getConfig ...");
  const pre = await api.getConfig();
  const preCfg = (pre.config as Record<string, unknown> | undefined) ?? pre;
  const mode = preCfg.mode as string | undefined;
  const battery = parseBatteryPercent(preCfg.batteryStatus);
  console.log(`[jump] mode=${mode}  battery=${preCfg.batteryStatus} (~${battery}%)`);
  if (mode && mode !== "standby") {
    if (target.skipReset) {
      console.log(`[jump] mode is '${mode}' — switch to STANDBY in UI now (needed before API configure)`);
      await waitForEnter("Switch mode to STANDBY in UI, then press ENTER.");
    } else {
      console.log(`[jump] ⚠ mode is '${mode}', expected 'standby'. Asking operator ...`);
      const ok = await askYesNo("Continue anyway?");
      if (!ok) throw new Error("Operator aborted: device not in standby");
    }
  }
  if (target.direction === "tunnel" && battery !== null && battery < 60) {
    console.log(`[jump] ⚠ tunnel normally requires battery ≥60%, current: ${battery}% — proceeding anyway`);
  }

  // 2) Reset (skip if we want to keep device at its current source date)
  if (target.skipReset) {
    console.log("\n[jump] skipping reset — keeping device at current source date");
  } else {
    console.log("\n[jump] reset ...");
    await api.reset();
  }

  // 3) Configure API params
  console.log("\n[jump] configure day/month/year ...");
  await api.configure("day", target.day);
  await api.configure("month", target.month);
  await api.configure("year", target.year);

  const sr = computeSyncRatio(target.day, target.month, target.year);
  console.log(`\n[jump] configure syncRatio=${sr.toFixed(2)} ...`);
  await api.configure("syncRatio", sr);

  // 4) Stabilization hint → LLM → configure
  console.log("\n[jump] getConfig to read needConfig hint ...");
  const hintCfg = await api.getConfig();
  const hint = (hintCfg.needConfig as string | undefined) ?? "";
  if (!hint) throw new Error("No needConfig hint returned — cannot compute stabilization");
  const stab = await extractStabilization(hint);
  console.log(`\n[jump] configure stabilization=${stab} ...`);
  await api.configure("stabilization", stab);

  // 5) Operator instructions
  const pwr = requiredPwr(target.year, docs);
  const expectedIM = internalModeFor(target.year);
  printOperatorInstructions(target, pwr, expectedIM);
  await waitForEnter("Set PT-A/PT-B/PWR and flip mode to 'active' in UI.");

  // 6) Operator watches UI — internalMode cycles automatically; sphere becomes clickable
  //    only when internalMode matches expected value AND fluxDensity shows 100%.
  //    No API polling here — it lags and misses the ~2s window.
  console.log(`\n[jump] ━━━ WATCH THE UI — DO NOT LOOK AT TERMINAL ━━━`);
  console.log(`[jump]   1. MODE indicator (top bar) cycles: 1→2→3→4→1...`);
  console.log(`[jump]   2. Wait for position ${expectedIM} (${expectedIM}. lampka od lewej) to light up`);
  console.log(`[jump]   3. At that moment Flux Density should jump to 100% → sphere turns GREEN`);
  console.log(`[jump]   4. Click sphere IMMEDIATELY — window lasts ~2 seconds`);
  console.log(`[jump]   5. Then come back here and press ENTER\n`);
  await waitForEnter("Press ENTER after clicking the green sphere.");

  // 8) Final verification
  console.log("\n[jump] final getConfig ...");
  const final = await api.getConfig();
  const fc = (final.config as Record<string, unknown> | undefined) ?? final;
  console.log(`[jump] post-jump currentDate=${fc.currentDate}  mode=${fc.mode}  battery=${fc.batteryStatus}`);
  return final;
}

// ─── Main ────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ STEP 1: bootstrap ━━━");
  console.log(`[config] HUB=${HUB}`);
  console.log(`[config] TASK=${TASK_NAME}`);
  console.log(`[config] AI_DEVS_KEY length=${AI_DEVS_KEY.length}`);

  console.log("\n[check] calling /verify with action=help ...");
  const helpResponse = await api.help();
  if (helpResponse.code !== undefined) {
    console.log(`[check] response.code=${helpResponse.code}`);
  }
  console.log("[check] full help response keys:", Object.keys(helpResponse));
  console.log("[check] help response:", JSON.stringify(helpResponse, null, 2));
  console.log("[check] bootstrap OK — API reachable");

  console.log("\n━━━ STEP 2: load documentation ━━━");
  const forceRefresh = process.argv.includes("--refresh-docs");
  const docs = await loadDocs(forceRefresh);

  const lines = docs.split("\n");
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l));
  console.log(`[docs] total lines=${lines.length}, headings=${headings.length}`);

  console.log("\n━━━ STEP 3: API client self-test ━━━");

  console.log("\n[step3] 3.1 getConfig (initial state) ...");
  await api.getConfig();

  console.log("\n[step3] 3.2 reset device ...");
  await api.reset();

  console.log("\n[step3] 3.3 getConfig (after reset) ...");
  const afterReset = await api.getConfig();

  console.log("\n[step3] 3.4 probe configure: year=2238 ...");
  await api.configure("year", 2238);

  console.log("\n[step3] 3.5 getConfig (after year change) ...");
  await api.getConfig();

  console.log("\n[step3] 3.6 reset to clean state ...");
  await api.reset();

  console.log("\n[step3] summary: initial config keys →", Object.keys(afterReset));
  console.log("[step3] API client self-test OK");

  console.log("\n━━━ STEP 4: rules self-check ━━━");
  const targets: Array<{ label: string; d: number; m: number; y: number }> = [
    { label: "jump #1 → 2238-11-05 (grab batteries)", d: 5, m: 11, y: 2238 },
    { label: "jump #2 → today 2026-04-15 (back home)", d: 15, m: 4, y: 2026 },
    { label: "tunnel  → 2024-11-12 (meet Rafał)", d: 12, m: 11, y: 2024 },
  ];

  for (const t of targets) {
    const sr = computeSyncRatio(t.d, t.m, t.y);
    const im = internalModeFor(t.y);
    const pwr = requiredPwr(t.y, docs);
    console.log(
      `[rules] ${t.label.padEnd(42)} syncRatio=${sr.toFixed(2)}  internalMode=${im}  PWR=${pwr}`
    );
  }

  console.log("[step4] rules self-check OK");

  console.log("\n━━━ STEP 5a: probe — full config for 2238-11-05 via API only ━━━");
  console.log("[5a] purpose: observe stabilization hint, fluxDensity progression, internalMode");

  console.log("\n[5a] reset ...");
  await api.reset();

  console.log("\n[5a] configure day=5 ...");
  await api.configure("day", 5);

  console.log("\n[5a] configure month=11 ...");
  await api.configure("month", 11);

  console.log("\n[5a] configure year=2238 ...");
  await api.configure("year", 2238);

  console.log("\n[5a] configure syncRatio=0.82 ...");
  await api.configure("syncRatio", 0.82);

  console.log("\n[5a] getConfig (expect stabilization hint somewhere in response) ...");
  const cfg = await api.getConfig();

  console.log("\n━━━ STEP 5b: LLM parser for needConfig ━━━");
  const hint = (cfg.needConfig as string | undefined) ?? "";
  if (!hint) {
    console.log("[5b] no needConfig present — cannot test parser");
  } else {
    const stab = await extractStabilization(hint);
    console.log(`[5b] extracted stabilization = ${stab}  (expected 189 for 2238-11-05)`);
  }

  console.log("\n━━━ STEP 5c2: test stabilization=900 vs 189 (condition check) ━━━");
  console.log("\n[test] reset ...");
  await api.reset();
  await api.configure("day", 5);
  await api.configure("month", 11);
  await api.configure("year", 2238);
  await api.configure("syncRatio", 0.82);

  console.log("\n[test] stabilization=189 (battery-saving recommendation) ...");
  await api.configure("stabilization", 189);
  const cfg189 = await api.getConfig();
  const c189 = (cfg189.config as Record<string, unknown> | undefined) ?? cfg189;
  console.log(`[test] condition=${c189.condition}  fluxDensity=${c189.fluxDensity}`);

  console.log("\n[test] stabilization=900 (full 'by the book' value) ...");
  await api.configure("stabilization", 900);
  const cfg900 = await api.getConfig();
  const c900 = (cfg900.config as Record<string, unknown> | undefined) ?? cfg900;
  console.log(`[test] condition=${c900.condition}  fluxDensity=${c900.fluxDensity}`);

  console.log("\n[test] resetting back ...");
  await api.reset();

  console.log("\n━━━ STEP 5d: execute jump #1 → 2238-11-05 ━━━");
  const jump1: JumpTarget = {
    label: "jump #1 → 2238-11-05 (grab batteries)",
    day: 5,
    month: 11,
    year: 2238,
    direction: "future", // 2238 > 2026 → jump forward in time → PT-B
  };
  await performJump(jump1, docs);
  console.log("\n[step5d] jump #1 completed");

  console.log("\n━━━ STEP 6: jump #2 → 2026-04-15 (back home) ━━━");
  const jump2: JumpTarget = {
    label: "jump #2 → 2026-04-15 (back home)",
    day: 15,
    month: 4,
    year: 2026,
    direction: "past",   // from 2238 → 2026 = going back to the past → PT-A
    skipReset: true,     // don't reset — keep device at currentDate=2238 so direction is valid
  };
  await performJump(jump2, docs);
  console.log("\n[step6] jump #2 completed");

  console.log("\n━━━ STEP 7: tunnel → 2024-11-12 (meet Rafał) ━━━");
  const jump3: JumpTarget = {
    label: "tunnel → 2024-11-12 (meet Rafał)",
    day: 12,
    month: 11,
    year: 2024,
    direction: "tunnel", // PT-A + PT-B — requires battery ≥60%
    skipReset: true,     // don't reset — preserve 2/3 battery from jump #2
  };
  await performJump(jump3, docs);
  console.log("\n[step7] tunnel completed");
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
