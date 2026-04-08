// ─── Imports ──────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Load .env from project root ──────────────────────────────────────────────
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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
const TASK = "radiomonitoring";
const MODEL_TEXT = "openai/gpt-4.1-mini";
const MODEL_VISION = "google/gemini-2.0-flash-001";

// ─── Clients ──────────────────────────────────────────────────────────────────
const openrouter = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface HubResponse {
  code: number;
  message?: string;
  msg?: string;
  transcription?: string;
  meta?: string;
  attachment?: string;
  filesize?: number;
}

interface ProcessedSignal {
  type: "transcription" | "csv" | "json" | "xml" | "image" | "audio";
  content: string;
  source: string;
}

// All four fields the final report needs.
// null = not found yet.
interface ReportState {
  cityName: string | null;
  cityArea: string | null;       // "XX.XX" — exactly 2 decimal places
  warehousesCount: number | null;
  phoneNumber: string | null;
}

// ─── Session end detection ────────────────────────────────────────────────────
const ACTIVE_CODES = new Set([100, 110]);
const END_KEYWORDS = [
  "enough", "no more", "complete", "finished", "done",
  "wystarczy", "koniec", "zakończ", "dostatecznie",
];

// ─── Hub helper ───────────────────────────────────────────────────────────────
async function callHub(answer: Record<string, unknown>): Promise<HubResponse> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`Hub HTTP error: ${res.status} | body: ${body}`);
  }
  return res.json() as Promise<HubResponse>;
}

// ─── Router: noise detection ──────────────────────────────────────────────────
const NOISE_TOKENS_RE =
  /\b(trzask|pisk|ksssh|ksssssh|kshhh|kshhhhh|kssss|szum|bzzt|bzzzzt|bzzzzzzz|bzzzzzz|szzzzz|szzz|bzzzzz|bzzzt|bzzzzzt)\b/gi;

function isNoisyTranscription(text: string): boolean {
  const words = text.trim().split(/\s+/).length;
  const noiseCount = (text.match(NOISE_TOKENS_RE) ?? []).length;
  const ellipsisCount = (text.match(/\.\.\./g) ?? []).length;
  return noiseCount / words > 0.15 || ellipsisCount / words > 0.2;
}

// ─── Router: attachment processing ───────────────────────────────────────────
function decodeBase64ToText(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

async function analyzeImage(b64: string, mimeType: string): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: MODEL_VISION,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
        { type: "text", text: "Describe everything visible in this image in detail. Include all text, numbers, labels, map markings, chart values, or any data present. Be thorough and precise." },
      ],
    }],
  });
  return response.choices[0].message.content ?? "(no description)";
}

async function transcribeAudio(b64: string): Promise<string> {
  try {
    const response = await openrouter.chat.completions.create({
      model: MODEL_VISION,
      messages: [{
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: b64, format: "mp3" } },
          { type: "text", text: "Transcribe this audio exactly, in the original language (Polish). Return only the transcription text, nothing else." },
        ],
      }],
    });
    return response.choices[0].message.content ?? "(empty transcription)";
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    console.error("[audio] error — status:", e.status, "| message:", e.message);
    return `(audio transcription failed: ${e.message ?? String(err)})`;
  }
}

async function routeAttachment(response: HubResponse): Promise<ProcessedSignal | null> {
  const { meta = "", attachment = "", filesize = 0 } = response;
  if (!attachment) return null;

  if (meta === "text/csv")
    return { type: "csv", content: decodeBase64ToText(attachment), source: `CSV (${filesize}B)` };

  if (meta === "text/xml" || meta === "application/xml")
    return { type: "xml", content: decodeBase64ToText(attachment), source: `XML (${filesize}B)` };

  if (meta === "text/plain")
    return { type: "transcription", content: decodeBase64ToText(attachment), source: `TXT (${filesize}B)` };

  if (meta === "application/json") {
    const raw = decodeBase64ToText(attachment);
    try {
      return { type: "json", content: JSON.stringify(JSON.parse(raw), null, 2), source: `JSON (${filesize}B)` };
    } catch {
      return { type: "json", content: raw, source: `JSON malformed (${filesize}B)` };
    }
  }

  if (meta.startsWith("image/")) {
    if (filesize > 1_000_000) { console.log(`[router]   ✗ image too large — skipped`); return null; }
    console.log(`[router]   → vision model…`);
    return { type: "image", content: await analyzeImage(attachment, meta), source: `${meta} (${filesize}B)` };
  }

  if (meta.startsWith("audio/")) {
    if (filesize > 1_000_000) { console.log(`[router]   ✗ audio too large — skipped`); return null; }
    console.log(`[router]   → audio transcription…`);
    return { type: "audio", content: await transcribeAudio(attachment), source: `${meta} (${filesize}B)` };
  }

  console.log(`[router]   ✗ unknown type "${meta}" — skipped`);
  return null;
}

// ─── Step 4: Report extraction ────────────────────────────────────────────────

// Returns fields still missing in state
function missingFields(state: ReportState): string[] {
  return (Object.keys(state) as (keyof ReportState)[]).filter((k) => state[k] === null);
}

function isReportComplete(state: ReportState): boolean {
  return missingFields(state).length === 0;
}

// Validates a single extracted value before accepting it into state.
// Rejects obvious LLM hallucinations (e.g. returning the codename instead of the real name).
function isValidUpdate(key: keyof ReportState, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (key === "cityName") {
    const name = String(value).trim().toLowerCase();
    // LLM must NOT return the codename itself — that is not an answer
    if (name === "syjon" || name === "zion" || name === "") return false;
  }
  if (key === "phoneNumber") {
    // Must look like a real phone number (at least 7 digits, ignoring separators)
    const digits = String(value).replace(/\D/g, "");
    if (digits.length < 7) return false;
  }
  if (key === "cityArea") {
    // Must be a decimal number string with exactly 2 decimal places
    if (!/^\d+\.\d{2}$/.test(String(value).trim())) return false;
  }
  if (key === "warehousesCount") {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || n > 1000) return false;
  }
  return true;
}

// Merges update into state — only fills null fields, never overwrites found values,
// and validates each value before accepting it.
function mergeState(current: ReportState, update: Partial<ReportState>): ReportState {
  const next = { ...current };
  for (const key of Object.keys(update) as (keyof ReportState)[]) {
    if (next[key] === null && isValidUpdate(key, update[key])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (next as any)[key] = update[key];
    } else if (next[key] === null && update[key] != null) {
      console.warn(`[extract]  ✗ Rejected invalid value for ${key}: ${JSON.stringify(update[key])}`);
    }
  }
  return next;
}

// The system prompt explains the task context and what fields we need.
// It is reused for every per-signal call AND the fallback comprehensive call.
const EXTRACTION_SYSTEM_PROMPT = `You are an intelligence analyst extracting information from intercepted radio signals.

Goal: identify the city known by the CODENAME "Syjon" and gather its data.

Fields needed:
- cityName      : REAL geographic name of the city called "Syjon". CRITICAL: this CANNOT be "Syjon" or "Zion" — those are codenames. You must find the actual Polish city name (e.g. "Skarszewy", "Puck", etc.)
- cityArea      : area in km² as a string with EXACTLY 2 decimal places, e.g. "10.73" (mathematical rounding, not truncation)
- warehousesCount : integer — number of warehouses CURRENTLY existing in Syjon (NOT planned/under construction). If the signal says "we plan to build warehouse N", the current count is N-1.
- phoneNumber   : FULL phone number of the contact person from Syjon (must contain at least 7 digits)

Hints:
- Morse notation: "Ti" = dot (.), "Ta" = dash (-). Each space-separated group is ONE character. "(stop)" = word boundary.
- XML tagged trainingData="true" is archival/fictional world-building data — likely NOT about Syjon.
- cityArea must be mathematically rounded (not truncated) to 2 decimal places.
- Only fill a field when you have DIRECT, EXPLICIT evidence. Do NOT infer or guess.

Respond ONLY with a valid JSON object. Use null for fields you cannot determine from this signal.
Example: {"cityName": "Skarszewy", "cityArea": null, "warehousesCount": null, "phoneNumber": null}`;

// Asks the LLM to extract report fields from a single signal.
// Uses Variant A (stateless): each call sees only one new signal + current known state.
// This is cheap and usually sufficient — data tends to be self-contained per signal.
async function extractFromSignal(
  signal: ProcessedSignal,
  state: ReportState,
): Promise<Partial<ReportState>> {
  const missing = missingFields(state);
  if (missing.length === 0) return {};

  const response = await openrouter.chat.completions.create({
    model: MODEL_TEXT,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Current known state: ${JSON.stringify(state)}
Still missing: ${missing.join(", ")}

New signal (type=${signal.type}, source=${signal.source}):
---
${signal.content}
---
Return JSON with any newly found fields. null for the rest.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "{}";
  try {
    return JSON.parse(raw) as Partial<ReportState>;
  } catch {
    console.warn("[extract] Failed to parse LLM response:", raw.slice(0, 200));
    return {};
  }
}

// Fallback: if per-signal extraction didn't fill all fields,
// send ALL collected signals to LLM in one comprehensive call.
async function extractFromAllSignals(
  signals: ProcessedSignal[],
  state: ReportState,
): Promise<Partial<ReportState>> {
  const allContent = signals
    .map((s, i) => `[${i + 1}] type=${s.type} | source=${s.source}\n${s.content}`)
    .join("\n\n---\n\n");

  return extractFromSignal(
    { type: "transcription", content: allContent, source: "ALL signals combined" },
    state,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // ── STEP 1: Start session ──────────────────────────────────────────────────
  console.log("\n━━━ STEP 1: Start radio monitoring session ━━━");
  const startResponse = await callHub({ action: "start" });
  console.log("[step 1] code:", startResponse.code, "| message:", startResponse.message ?? startResponse.msg);

  // ── STEP 2 + 3 + 4: Listen loop with router + live extraction ─────────────
  console.log("\n━━━ STEP 2+3+4: Listen → route → extract ━━━");

  const signals: ProcessedSignal[] = [];
  const reportState: ReportState = { cityName: null, cityArea: null, warehousesCount: null, phoneNumber: null };
  const MAX_LISTEN = 100;

  for (let i = 1; i <= MAX_LISTEN; i++) {
    const response = await callHub({ action: "listen" });
    const message = response.message ?? response.msg ?? "";

    const isEnd =
      !ACTIVE_CODES.has(response.code) ||
      END_KEYWORDS.some((kw) => message.toLowerCase().includes(kw));

    console.log(`\n[listen #${i}] code=${response.code}`);

    // ── Route signal ──────────────────────────────────────────────────────────
    let signal: ProcessedSignal | null = null;

    if (response.transcription) {
      const text = response.transcription.trim();
      if (isNoisyTranscription(text)) {
        console.log(`[router]   ✗ NOISE — skipped`);
      } else {
        console.log(`[router]   ✓ TRANSCRIPTION (${text.slice(0, 70).replace(/\n/g, " ")}…)`);
        signal = { type: "transcription", content: text, source: `listen #${i}` };
      }
    }

    if (response.attachment) {
      console.log(`[router]   attachment: ${response.meta} (${response.filesize}B)`);
      const attachSignal = await routeAttachment(response);
      if (attachSignal) {
        console.log(`[router]   ✓ ${attachSignal.type.toUpperCase()} (${attachSignal.content.slice(0, 80).replace(/\n/g, " ")}…)`);
        signal = attachSignal;
      }
    }

    if (signal) {
      signals.push(signal);
    }

    if (isEnd) {
      console.log(`\n[step 2] Session ended. code=${response.code} | "${message}"`);
      break;
    }
  }

  // ── STEP 4: Comprehensive analysis of all signals ─────────────────────────
  // Per-signal (Variant A) extraction was unreliable for cityName — identifying
  // which city IS "Syjon" requires cross-referencing multiple signals (transcriptions,
  // JSON city data, audio). A single comprehensive call is more accurate.
  console.log(`\n━━━ STEP 4: Comprehensive extraction (${signals.length} signals) ━━━`);
  console.log("\n[signals] Full content dump:");
  for (const [i, s] of signals.entries()) {
    console.log(`\n  [${i + 1}] type=${s.type} | source=${s.source}`);
    console.log(`  ${s.content.slice(0, 500)}`);
  }
  const update = await extractFromAllSignals(signals, reportState);
  let finalState = mergeState(reportState, update);
  console.log(`[extract]  Result: ${JSON.stringify(finalState)}`);

  if (!isReportComplete(finalState)) {
    console.log(`[extract]  ⚠ Still missing: ${missingFields(finalState).join(", ")}`);
  }

  // ── STEP 4 summary ─────────────────────────────────────────────────────────
  console.log("\n━━━ STEP 4: Extraction summary ━━━");
  console.log("Report state:", JSON.stringify(finalState, null, 2));
  console.log("Complete:", isReportComplete(finalState));

  if (!isReportComplete(finalState)) {
    console.error("[step 5] Cannot transmit — report incomplete. Missing:", missingFields(finalState).join(", "));
    return;
  }

  // ── STEP 5: Transmit final report ─────────────────────────────────────────
  console.log("\n━━━ STEP 5: Transmit final report ━━━");

  const transmitResponse = await callHub({
    action: "transmit",
    cityName: finalState.cityName!,
    cityArea: finalState.cityArea!,
    warehousesCount: finalState.warehousesCount!,
    phoneNumber: finalState.phoneNumber!,
  });

  console.log("[step 5] Hub response:", JSON.stringify(transmitResponse, null, 2));

  const flag = JSON.stringify(transmitResponse).match(/\{FLG:[^}]+\}/)?.[0];
  if (flag) {
    console.log("\n[step 5] 🚩 FLAG:", flag);
  }
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
