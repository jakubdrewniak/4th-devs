import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

const ZMAIL_URL = "https://hub.ag3nts.org/api/zmail";
const VERIFY_URL = "https://hub.ag3nts.org/verify";
const MODEL = "openai/gpt-5.4-nano";

console.log("[config] Setup complete ✓");
console.log(`[config] ZMAIL_URL: ${ZMAIL_URL}`);
console.log(`[config] Model: ${MODEL}`);
console.log(`[config] Keys loaded: AI_DEVS_KEY=${!!AI_DEVS_KEY}, OPENROUTER_KEY=${!!OPENROUTER_KEY}`);

// ─── Tools (implementations) ──────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function zmailRequest(body: Record<string, unknown>, retries = 4): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(ZMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, ...body }),
    });

    if (res.status === 429) {
      const wait = attempt * 3000;
      console.warn(`[zmail] 429 Rate limit (attempt ${attempt}/${retries}), retrying in ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) throw new Error(`zmail HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("zmail: max retries exceeded after 429 rate limit");
}

async function toolHelp(): Promise<string> {
  console.log("[tool:help] Calling zmail help...");
  const data = await zmailRequest({ action: "help", page: 1 });
  const result = JSON.stringify(data, null, 2);
  console.log("[tool:help] Response:\n", result);
  return result;
}

async function toolSearchMail(query: string, page = 1): Promise<string> {
  console.log(`[tool:search_mail] query="${query}" page=${page}`);
  const data = await zmailRequest({ action: "search", query, page });
  const result = JSON.stringify(data, null, 2);
  console.log("[tool:search_mail] Response:\n", result);
  return result;
}

async function toolGetThread(threadID: string): Promise<string> {
  console.log(`[tool:get_thread] threadID="${threadID}"`);
  const data = await zmailRequest({ action: "getThread", threadID });
  const result = JSON.stringify(data, null, 2);
  console.log("[tool:get_thread] Response:\n", result);
  return result;
}

async function toolGetMessages(ids: string | string[]): Promise<string> {
  console.log(`[tool:get_messages] ids=${JSON.stringify(ids)}`);
  const data = await zmailRequest({ action: "getMessages", ids });
  const result = JSON.stringify(data, null, 2);
  console.log("[tool:get_messages] Response:\n", result);
  return result;
}

interface AnswerPayload {
  password: string;
  date: string;
  confirmation_code: string;
}

async function toolSubmitAnswer(answer: AnswerPayload): Promise<string> {
  console.log("[tool:submit_answer] Submitting:", JSON.stringify(answer));
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "mailbox", answer }),
  });
  const data = await res.json();
  const result = JSON.stringify(data, null, 2);
  console.log("[tool:submit_answer] Response:\n", result);
  return result;
}

// ─── Tool definitions (for LLM) ───────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "help",
      description: "Check available zmail API actions and their parameters. Call this first to understand the API.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_mail",
      description: "Search the mailbox using Gmail-style operators (from:, to:, subject:, OR, AND). Returns a list of matching emails with metadata (id, subject, from, date) but WITHOUT body content.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query, e.g. 'from:proton.me' or 'subject:password'" },
          page: { type: "number", description: "Page number for pagination, starting at 1" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thread",
      description: "Fetch rowID and messageID list for a thread. Use this after search_mail when you have a threadID. Returns IDs needed for get_messages — does NOT return message body.",
      parameters: {
        type: "object",
        properties: {
          threadID: { type: "string", description: "Numeric thread ID returned by search_mail" },
        },
        required: ["threadID"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_messages",
      description: "Fetch full body of one or more messages by their rowID or 32-char messageID. Always use this to read actual email content before extracting values.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            description: "A single rowID/messageID or an array of them",
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
          },
        },
        required: ["ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the three found values to the verification endpoint. Returns a flag {FLG:...} if all values are correct, or error feedback if any value is wrong.",
      parameters: {
        type: "object",
        properties: {
          password: { type: "string", description: "Employee system password found in the mailbox" },
          date: { type: "string", description: "Date of planned attack in YYYY-MM-DD format" },
          confirmation_code: { type: "string", description: "Security ticket confirmation code, format: SEC- followed by 32 characters (36 chars total)" },
        },
        required: ["password", "date", "confirmation_code"],
        additionalProperties: false,
      },
    },
  },
];

console.log(`[config] Tools registered: ${TOOLS.map((t) => t.function.name).join(", ")}`);

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are an intelligence agent searching a compromised email inbox for three specific pieces of information.

## Your goal
Find these three values and submit them together using submit_answer:
1. **date** — the date (YYYY-MM-DD) when the security department plans to attack our power plant
2. **password** — the employee system password found somewhere in this inbox
3. **confirmation_code** — a security ticket confirmation code in format: SEC- followed by exactly 32 characters (36 chars total)

## What you know
- A person named Wiktor (last name unknown) sent an email that reported on us. He sent it from a @proton.me domain.
- The inbox is active — new messages may arrive during your search. If you cannot find something, try again later.

## Strategy
1. Search broadly first, then narrow down. The emails are in Polish — use Polish keywords.
2. For every promising search result — use get_thread to get the message IDs, then get_messages to read the full body. Never guess from subject alone.
3. Search for each of the three values independently using targeted queries.
4. Once you have all three values, submit with submit_answer.
5. Read the feedback carefully. If a value is wrong, search again for that specific value and resubmit.
6. If a search returns nothing, retry — the message may not have arrived yet.

## Polish keywords to use in searches
- password: "hasło", "hasla", "login", "dostęp", "dane logowania", "poświadczenia"
- attack date: "atak", "data", "planowany", "operacja", "akcja"
- confirmation code: "SEC-", "kod potwierdzenia", "ticket", "zgłoszenie"
- sender: from:proton.me, "Wiktor"

## Reading email flow (always follow this)
search_mail → get_thread (to get messageIDs) → get_messages (to read body)

## Important rules
- The confirmation_code must be exactly 36 characters: SEC- + 32 chars. Verify the length before submitting.
- The date must be in YYYY-MM-DD format.
- Never assume — always read the full email body before extracting values.
- The inbox is live. If something is missing, wait and retry the search.`;

console.log("[config] System prompt ready ✓");

// ─── Agent loop ───────────────────────────────────────────────────────────────

const MAX_STEPS = 30;

async function runAgent(): Promise<void> {
  const messages: { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string }[] = [
    { role: "user", content: "Search the mailbox and find the three required values: date, password, and confirmation_code. Then submit them." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ── step ${step}/${MAX_STEPS} ──`);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    const data = await res.json() as { choices: { message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]; error?: { message: string } };
    if (!res.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${res.status}`);

    const msg = data.choices[0].message;
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    if (!msg.tool_calls?.length) {
      console.log(`\n[agent] Agent finished without flag:\n${msg.content}`);
      return;
    }

    console.log(`[agent] Requested ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: string;

      try {
        if (call.function.name === "help") {
          result = await toolHelp();
        } else if (call.function.name === "search_mail") {
          result = await toolSearchMail(args.query as string, args.page as number | undefined);
        } else if (call.function.name === "get_thread") {
          result = await toolGetThread(args.threadID as string);
        } else if (call.function.name === "get_messages") {
          result = await toolGetMessages(args.ids as string | string[]);
        } else if (call.function.name === "submit_answer") {
          result = await toolSubmitAnswer(args as unknown as AnswerPayload);
          const flagMatch = result.match(/\{FLG:[^}]+\}/);
          if (flagMatch) {
            console.log(`\n[agent] ✓ FLAG FOUND: ${flagMatch[0]}`);
            return;
          }
        } else {
          result = `Unknown tool: ${call.function.name}`;
          console.warn(`[agent] Unknown tool called: ${call.function.name}`);
        }
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[agent] Tool "${call.function.name}" failed: ${result}`);
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runAgent().catch((err: Error) => {
  console.error("[error]", err.message);
  process.exit(1);
});