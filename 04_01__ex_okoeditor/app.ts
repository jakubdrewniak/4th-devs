import OpenAI from "openai";
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
const AI_DEVS_KEY    = process.env.AI_DEVS_KEY?.trim()        ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY)    { console.error("[config] Missing AI_DEVS_KEY");        process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB        = "https://hub.ag3nts.org";
const OKO_PANEL  = "https://oko.ag3nts.org";
const OKO_LOGIN  = "Zofia";
const OKO_PASS   = "Zofia2026!";
const MODEL      = "openai/gpt-4.1-mini";
const MAX_STEPS  = 30;

console.log("[config] AI_DEVS_KEY loaded:", AI_DEVS_KEY.slice(0, 6) + "...", "| length:", AI_DEVS_KEY.length, "| has dashes:", AI_DEVS_KEY.includes("-"));
console.log("[config] OPENROUTER_KEY loaded:", OPENROUTER_KEY.slice(0, 6) + "...");
console.log("[config] HUB:", HUB, "| OKO_PANEL:", OKO_PANEL);
console.log("[config] MODEL:", MODEL);

// ─── OpenAI client (via OpenRouter) ───────────────────────────────────────────
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── OKO Panel session ────────────────────────────────────────────────────────
let okoSessionCookie = "";

async function okoLogin(): Promise<void> {
  if (okoSessionCookie) return;

  console.log("[oko_browse] Step 1: GET / to obtain initial session cookie...");
  const initRes = await fetch(`${OKO_PANEL}/`, { redirect: "manual" });
  const initCookie = initRes.headers.get("set-cookie");
  const preSession = initCookie ? initCookie.split(";")[0] : "";
  console.log("[oko_browse] Pre-session cookie:", preSession.slice(0, 30) + "...");

  console.log("[oko_browse] Step 2: POST login with pre-session cookie...");
  const formData = new URLSearchParams({
    action:     "login",
    login:      OKO_LOGIN,
    password:   OKO_PASS,
    access_key: AI_DEVS_KEY,
  });

  const loginRes = await fetch(`${OKO_PANEL}/`, {
    method:   "POST",
    headers:  {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie":        preSession,
    },
    body:     formData.toString(),
    redirect: "manual",
  });

  console.log("[oko_browse] Login POST status:", loginRes.status, "| location:", loginRes.headers.get("location"));

  const setCookie = loginRes.headers.get("set-cookie");
  if (setCookie) {
    okoSessionCookie = setCookie.split(";")[0];
    console.log("[oko_browse] Authenticated session cookie:", okoSessionCookie.slice(0, 30) + "...");
  } else {
    okoSessionCookie = preSession; // fallback — use pre-session
    console.warn("[oko_browse] No new Set-Cookie after POST, using pre-session.");
  }

  // Verify: GET a protected page and check it's NOT the login form
  const check = await fetch(`${OKO_PANEL}/notatki`, { headers: { Cookie: okoSessionCookie } });
  const checkBody = (await check.text()).match(/<body[\s\S]*<\/body>/i)?.[0] ?? "";
  const isLoggedIn = !checkBody.includes("login-wrap");
  console.log("[oko_browse] Login verification:", isLoggedIn ? "SUCCESS ✓" : "FAILED — still showing login page");
  if (!isLoggedIn) {
    console.log("[oko_browse] Body preview:", checkBody.slice(0, 300));
  }
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function okoApi(action: string, params?: Record<string, unknown>): Promise<unknown> {
  // Strip undefined/empty-string values; also strip "done" when page !== "zadania"
  const cleanParams = params
    ? Object.fromEntries(
        Object.entries(params).filter(([k, v]) => {
          if (v === undefined || v === "") return false;
          if (k === "done" && params["page"] !== "zadania") return false;
          return true;
        })
      )
    : undefined;

  const body = {
    apikey: AI_DEVS_KEY,
    task: "okoeditor",
    answer: { action, ...cleanParams },
  };

  console.log(`[oko_api] → action="${action}"`, params ? JSON.stringify(params) : "");

  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: unknown = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

  console.log(`[oko_api] ← response:`, JSON.stringify(data, null, 2));
  return data;
}

async function okoBrowse(page: string): Promise<string> {
  await okoLogin();

  const url = `${OKO_PANEL}/${page}`;
  console.log(`[oko_browse] → GET ${url}`);

  const res = await fetch(url, {
    headers: { Cookie: okoSessionCookie },
  });

  if (!res.ok) {
    throw new Error(`[oko_browse] HTTP ${res.status} for page "${page}"`);
  }

  const text = await res.text();
  console.log(`[oko_browse] ← received ${text.length} chars from "${page}"`);

  // Strip <head> — it's huge (CSS/JS). Return only <body> content.
  const bodyMatch = text.match(/<body[\s\S]*<\/body>/i);
  const body = bodyMatch ? bodyMatch[0] : text;
  console.log(`[oko_browse] ← body is ${body.length} chars`);

  // For individual note detail pages: return full plain text
  if (page.startsWith("notatki/")) {
    const fullText = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`[oko_browse] ← note detail full text (${fullText.length} chars):`);
    console.log(fullText);
    return `=== ${page} — full text ===\n\n${fullText}`;
  }

  // Extract structured records: find each 32-char hex ID and surrounding context
  const records: string[] = [];
  const idRegex = /[a-f0-9]{32}/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = idRegex.exec(body)) !== null) {
    const id = match[0];
    if (seen.has(id)) continue;
    seen.add(id);

    // Grab text around the ID (strip HTML tags for readability)
    const start = Math.max(0, match.index - 300);
    const end = Math.min(body.length, match.index + 500);
    const context = body.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    records.push(`ID: ${id}\nCONTEXT: ${context}`);
  }

  if (records.length > 0) {
    const structured = `=== ${page} — ${records.length} record(s) found ===\n\n` + records.join("\n\n---\n\n");
    console.log(`[oko_browse] ← extracted ${records.length} record(s)`);
    console.log(`[oko_browse] ← structured preview:\n${structured.slice(0, 1200)}\n---`);
    return structured;
  }

  // Fallback: return raw body if no IDs found
  console.log(`[oko_browse] ← no IDs found, returning raw body`);
  return body;
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "oko_api",
      description:
        "Call the OKO editor back-door API on the hub. Known actions: " +
        "'help' — returns API docs; " +
        "'update' — edits a record (requires: page, id, action; optional: content, title, done=YES|NO); " +
        "'done' — verifies all changes and returns the flag. " +
        "Pages for update: incydenty, notatki, zadania.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "API action: 'help' | 'update' | 'done'",
          },
          page: {
            type: "string",
            description: "For action='update': which page — 'incydenty' | 'notatki' | 'zadania'",
          },
          id: {
            type: "string",
            description: "For action='update': 32-char hex record ID obtained from oko_browse",
          },
          content: {
            type: "string",
            description: "For action='update': new content/description text",
          },
          title: {
            type: "string",
            description: "For action='update': new title text",
          },
          done: {
            type: "string",
            description: "For action='update' on page='zadania': 'YES' | 'NO'",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "oko_browse",
      description:
        "Browse a page of the OKO web panel to read its HTML content and discover record IDs. " +
        "Use this to find the 32-char hex IDs needed for oko_api update calls. " +
        "Useful pages: 'incydenty', 'notatki', 'zadania'. Also try root '' or 'dashboard'.",
      parameters: {
        type: "object",
        properties: {
          page: {
            type: "string",
            description:
              "Page path to browse, e.g. 'incydenty', 'zadania', 'notatki', '' (root).",
          },
        },
        required: ["page"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an agent with access to the OKO Operations Center system.
You have two tools:
- oko_browse(page): reads the OKO web panel page HTML to discover record IDs
- oko_api(action, params?): calls the hub back-door API to make changes

Your mission — complete ALL THREE tasks below, then call oko_api with action='done':

TASK 1: Change the classification of the Skolwin incident in "incydenty"
  - The record about Skolwin is in "incydenty" — originally titled "MOVE03 Trudne do klasyfikacji ruchy nieopodal miasta Skolwin"
  - Change its content and title to be about ANIMALS (e.g. beavers)
  - KEEP the word "Skolwin" in the title
  - Use ticket code MOVE04 (the valid code for animals = "zwierzęta")
  - Example title: "MOVE04 Wykryto zwierzęta w okolicach Skolwin"
  - The content MUST be a plain description of animals — do NOT include date/badge metadata in content

TASK 2: Find the task related to city "Skolwin" on the "zadania" page
  - Mark it as done (done=YES)
  - Update its content to mention that animals were seen there (e.g. beavers)

TASK 3: Add an incident about city "Komarowo" — use a DIFFERENT record than the Skolwin one
  - Pick a DIFFERENT existing incydenty record (e.g. the one about Domatowo) and repurpose it for Komarowo
  - Use ticket code MOVE01 (the valid code for human movement = "człowiek")
  - Example title: "MOVE01 Wykryto ruch ludzi w okolicach Komarowo"
  - The word "Komarowo" must appear in the title
  - The content MUST be a plain description of people movement — do NOT include date/badge metadata in content

STEP 4 — VERIFY before calling done:
  - Browse "incydenty" again and confirm: Skolwin record has valid ticket code + "Skolwin" in title
  - Browse "zadania" again and confirm: Skolwin task is done=YES
  - Only then call oko_api with action='done'

Important rules:
- Browse each page first to read current state before making changes
- The incydenty page has multiple records — use the CORRECT one for each task
- City names in titles: use "Skolwin" (not "Skolwina"), "Komarowo" (not "Komarowa")
- If done returns an error, re-browse to check current state and fix the specific issue`;

// ─── Agent loop ───────────────────────────────────────────────────────────────
async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Please complete all three tasks and call done when finished." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ━━━ step ${step}/${MAX_STEPS} ━━━`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished (no tool calls): ${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: string;

      if (call.function.name === "oko_api") {
        const { action, ...params } = args;
        const raw = await okoApi(action as string, Object.keys(params).length ? params : undefined);
        result = JSON.stringify(raw);

        // Check for flag
        const flagMatch = result.match(/\{FLG:[^}]+\}/);
        if (flagMatch) {
          console.log(`\n[agent] ✓ FLAG FOUND: ${flagMatch[0]}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
          return;
        }
      } else if (call.function.name === "oko_browse") {
        const page = args.page as string;
        result = await okoBrowse(page);
      } else {
        result = `Unknown tool: ${call.function.name}`;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ STEP 3: Agent loop start ━━━");
  await runAgent();
  console.log("\n[main] Agent finished.");
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
