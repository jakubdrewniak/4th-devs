import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// ─── Load .env from project root ─────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY = process.env.AI_DEVS_KEY!;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const ORCHESTRATOR_MODEL = "anthropic/claude-sonnet-4-6";
const ANALYSIS_MODEL = "openai/gpt-5.4-nano";

const LOG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "failure-log.txt");

// ─── Load log file ────────────────────────────────────────────────────────────

const logLines = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);

console.log("[setup] Log file loaded");
console.log(`[setup] Total lines: ${logLines.length}`);

const counts = { CRIT: 0, ERRO: 0, WARN: 0, INFO: 0 };
for (const line of logLines) {
  if (line.includes("[CRIT]")) counts.CRIT++;
  else if (line.includes("[ERRO]")) counts.ERRO++;
  else if (line.includes("[WARN]")) counts.WARN++;
  else if (line.includes("[INFO]")) counts.INFO++;
}

console.log(`[setup] Severity breakdown:`);
console.log(`         CRIT: ${counts.CRIT}`);
console.log(`         ERRO: ${counts.ERRO}`);
console.log(`         WARN: ${counts.WARN}`);
console.log(`         INFO: ${counts.INFO}`);
console.log(`[setup] Keys loaded: AI_DEVS_KEY=${!!API_KEY}, OPENROUTER_KEY=${!!OPENROUTER_KEY}`);
console.log(`[setup] Models: orchestrator=${ORCHESTRATOR_MODEL}, analysis=${ANALYSIS_MODEL}`);

// ─── Token usage tracking ─────────────────────────────────────────────────────

const tokenUsage = {
  orchestrator: { prompt: 0, completion: 0 },
  analysis: { prompt: 0, completion: 0 },
};

function addUsage(target: keyof typeof tokenUsage, usage: { prompt_tokens?: number; completion_tokens?: number }) {
  tokenUsage[target].prompt += usage?.prompt_tokens ?? 0;
  tokenUsage[target].completion += usage?.completion_tokens ?? 0;
}

// ─── Tool: search_logs ────────────────────────────────────────────────────────
// Filters log lines by query (component name / keyword) and optional severity,
// then asks the cheap model to compress the matching lines.

type Severity = "CRIT" | "ERRO" | "WARN" | "INFO";

async function searchLogs(query: string, severity?: Severity): Promise<string> {
  // 1. Filter lines locally — no LLM cost for this part
  const queryLower = query.toLowerCase();
  const matched = logLines.filter((line) => {
    const matchesQuery = line.toLowerCase().includes(queryLower);
    const matchesSeverity = severity ? line.includes(`[${severity}]`) : true;
    return matchesQuery && matchesSeverity;
  });

  console.log(`[search_logs] query="${query}" severity=${severity ?? "any"} → ${matched.length} lines matched`);

  if (matched.length === 0) return "";

  // 2. Send matched lines to cheap model for compression
  const prompt = `You are a log compressor for nuclear power plant incident analysis.
Compress the following log lines. Rules:
- Keep one line per event
- Preserve: timestamp (YYYY-MM-DD HH:MM), severity [CRIT/ERRO/WARN], component ID
- Shorten descriptions to max 8 words
- Remove duplicate/redundant events (same component, same issue)
- Output only the compressed lines, nothing else

Log lines:
${matched.join("\n")}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);

  addUsage("analysis", data.usage);

  const compressed = data.choices[0].message.content.trim();
  const compressedLines = compressed.split("\n").filter(Boolean).length;
  console.log(`[search_logs] compressed: ${matched.length} → ${compressedLines} lines`);

  return compressed;
}

// ─── Tool: count_tokens ───────────────────────────────────────────────────────
// Conservative estimate: 1 token ≈ 4 characters

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Tool: submit_answer ──────────────────────────────────────────────────────
// POSTs compressed logs to the verification endpoint and returns the response.

const VERIFY_ENDPOINT = "https://hub.ag3nts.org/verify";
const TOKEN_LIMIT = 1500;

async function submitAnswer(logs: string): Promise<{ message: string; flag?: string }> {
  const tokens = countTokens(logs);
  console.log(`[submit] Token estimate: ${tokens}/${TOKEN_LIMIT}`);

  if (tokens > TOKEN_LIMIT) {
    throw new Error(`[submit] Logs exceed token limit (${tokens} > ${TOKEN_LIMIT}). Compress further before sending.`);
  }

  const payload = {
    apikey: API_KEY,
    task: "failure",
    answer: { logs },
  };

  console.log(`[submit] Sending ${logs.split("\n").filter(Boolean).length} log lines...`);

  const res = await fetch(VERIFY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log(`[submit] Response (status=${res.status}):`, JSON.stringify(data, null, 2));

  return data;
}

// ─── Tool definitions for orchestrator ───────────────────────────────────────
// These are sent to the LLM so it knows what tools it can call.

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_logs",
      description: "Search the power plant log file for events matching a keyword or component ID. Returns compressed log lines with timestamps, severity and component ID. Use this to find events for specific components or topics.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or component ID to search for (e.g. 'ECCS8', 'PUMP', 'cooling').",
          },
          severity: {
            type: "string",
            enum: ["CRIT", "ERRO", "WARN", "INFO"],
            description: "Optional: filter by severity level. Omit to get all severities.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_tokens",
      description: "Estimate the token count of a text string. Use this before submitting to ensure the log is within the 1500-token limit.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to count tokens for." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit compressed logs to the verification endpoint. Returns technician feedback or a flag {FLG:...} if accepted. Only call this when token count is below 1500.",
      parameters: {
        type: "object",
        properties: {
          logs: {
            type: "string",
            description: "Newline-separated compressed log entries. Each line must contain: date (YYYY-MM-DD), time (HH:MM), severity [CRIT/ERRO/WARN], component ID, and a short description.",
          },
        },
        required: ["logs"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are an agent analyzing a nuclear power plant failure log.

Your goal: build a compressed log (max 1500 tokens) containing all events relevant to the failure analysis, then submit it to the verification endpoint until you receive a flag {FLG:...}.

Strategy:
1. Use search_logs to find CRIT and ERRO events across all components (try queries like "CRIT", "ERRO", power, cooling, pump, water, firmware, turbine, reactor).
2. Combine the results into a single log string (one event per line).
3. Use count_tokens to verify the total is under 1500 before submitting.
4. Submit with submit_answer. Read the technician feedback carefully.
5. If feedback says a component is missing or unclear — use search_logs to find more events for that component, add them, and resubmit.
6. Iterate until you receive a flag.

Rules:
- Never exceed 1500 tokens — check before every submission.
- Each log line must follow the format: [YYYY-MM-DD HH:MM] [SEVERITY] COMPONENT_ID short description
- Prefer CRIT > ERRO > WARN events. Include WARN only if it helps explain the failure chain.`;

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgent(): Promise<void> {
  const messages: any[] = [
    { role: "user", content: "Analyze the failure log, build a compressed summary under 1500 tokens, and get the flag from the verification endpoint." },
  ];

  const MAX_STEPS = 30;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] ── step ${step}/${MAX_STEPS} ──`);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: ORCHESTRATOR_MODEL,
        system: SYSTEM,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);

    addUsage("orchestrator", data.usage);

    const msg = data.choices[0].message;
    messages.push(msg);

    // No tool calls — agent finished or gave up
    if (!msg.tool_calls?.length) {
      console.log(`\n[agent] Finished without flag:\n${msg.content}`);
      return;
    }

    console.log(`[agent] Requested ${msg.tool_calls.length} tool call(s)`);

    // Execute each tool call
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: string;

      if (call.function.name === "search_logs") {
        const found = await searchLogs(args.query, args.severity);
        result = found || "(no matching log entries found)";
      } else if (call.function.name === "count_tokens") {
        const tokens = countTokens(args.text);
        result = `${tokens} tokens`;
      } else if (call.function.name === "submit_answer") {
        const response = await submitAnswer(args.logs);
        result = JSON.stringify(response);

        // Check for flag in the response
        const flagMatch = result.match(/\{FLG:[^}]+\}/);
        if (flagMatch) {
          console.log(`\n[agent] ✓ FLAG FOUND: ${flagMatch[0]}`);
          return;
        }
      } else {
        result = `Unknown tool: ${call.function.name}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

function logTokenUsage() {
  const orch = tokenUsage.orchestrator;
  const anal = tokenUsage.analysis;
  console.log("\n[tokens] ── Usage summary ──────────────────────────────");
  console.log(`[tokens] Orchestrator (${ORCHESTRATOR_MODEL}):`);
  console.log(`           prompt:     ${orch.prompt}`);
  console.log(`           completion: ${orch.completion}`);
  console.log(`           total:      ${orch.prompt + orch.completion}`);
  console.log(`[tokens] Analysis     (${ANALYSIS_MODEL}):`);
  console.log(`           prompt:     ${anal.prompt}`);
  console.log(`           completion: ${anal.completion}`);
  console.log(`           total:      ${anal.prompt + anal.completion}`);
  console.log(`[tokens] Grand total:  ${orch.prompt + orch.completion + anal.prompt + anal.completion}`);
  console.log("[tokens] ────────────────────────────────────────────────");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runAgent()
  .then(() => logTokenUsage())
  .catch((err) => {
    logTokenUsage();
    console.error("[error]", err.message);
    process.exit(1);
  });
