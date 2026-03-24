import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");
if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!AI_DEVS_KEY || !OPENROUTER_KEY) {
  console.error("[config] Missing AI_DEVS_KEY or OPENROUTER_API_KEY");
  process.exit(1);
}

const SHELL_API = "https://hub.ag3nts.org/api/shell";
const VERIFY_API = "https://hub.ag3nts.org/verify";
const MODEL = "anthropic/claude-sonnet-4-6";
const MAX_TURNS = 40;

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// --- Tools ---

async function shellCommand(cmd: string): Promise<string> {
  try {
    const res = await fetch(SHELL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, cmd }),
    });

    if (res.status === 429) {
      const body = await res.text();
      const match = body.match(/(\d+)/);
      const wait = match ? match[1] : "few";
      return `RATE_LIMITED: Wait ${wait} seconds before retrying. Body: ${body}`;
    }

    if (res.status === 403) {
      const body = await res.text();
      const match = body.match(/(\d+)/);
      const wait = match ? match[1] : "unknown";
      return `BANNED: Security rule violated. Wait ${wait} seconds. Body: ${body}`;
    }

    if (!res.ok) {
      return `HTTP_ERROR ${res.status}: ${await res.text()}`;
    }

    const data = await res.json() as Record<string, unknown>;
    return JSON.stringify(data);
  } catch (err) {
    return `NETWORK_ERROR: ${(err as Error).message}`;
  }
}

async function submitAnswer(confirmationCode: string): Promise<string> {
  const payload = {
    apikey: AI_DEVS_KEY,
    task: "firmware",
    answer: { confirmation: confirmationCode },
  };

  const res = await fetch(VERIFY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return JSON.stringify(data, null, 2);
}

// --- Tool definitions ---

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "shell_command",
      description:
        "Execute a shell command on the remote virtual machine. Returns raw API output. Start with 'help' to discover available commands — this shell is non-standard.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "The shell command to execute" },
        },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description:
        "Submit the ECCS- confirmation code to Centrala. Call this once you have obtained the code from running cooler.bin.",
      parameters: {
        type: "object",
        properties: {
          confirmation_code: {
            type: "string",
            description: "The full code in format ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          },
        },
        required: ["confirmation_code"],
      },
    },
  },
];

// --- System prompt ---

const SYSTEM_PROMPT = `You are an agent operating on a restricted Linux virtual machine via a Shell API.

GOAL: Run /opt/firmware/cooler/cooler.bin and obtain a code in format ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, then submit it.

SECURITY RULES — violations cause a temporary ban:
- You are a regular (non-root) user
- Do NOT access /etc, /root, or /proc/ directories
- If you find a .gitignore file in any directory, read it and never touch files/dirs listed there
- You may write to the firmware directory volume

STRATEGY:
1. Run 'help' first — the shell has a custom command set, standard Linux commands may not exist
2. Explore the filesystem to find the password (hint: it is stored in multiple locations)
3. Try running /opt/firmware/cooler/cooler.bin and diagnose the error
4. Inspect and fix settings.ini so the binary can run correctly
5. Run the binary again to get the ECCS- code
6. Call submit_answer with the code

NOTES:
- File editing works differently here — discover the right command via 'help'
- If you get RATE_LIMITED, wait the indicated number of seconds before retrying
- If you get BANNED, stop all commands and wait the indicated time
- If you make a mess, use the 'reboot' command to reset the VM
- Execute one command at a time and reason about the output before proceeding
- NEVER use 'cat' on .bin or other binary files — they produce huge output that crashes the session
- Do not read binary files at all; treat them as executable programs only`;

// --- Agent loop ---

async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Start the task. Run 'help' first to see what commands are available." },
  ];

  console.log(`[agent] Starting — model: ${MODEL}, max turns: ${MAX_TURNS}`);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n--- turn ${turn + 1}/${MAX_TURNS} ---`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (message.content) {
      console.log("[agent]", message.content.slice(0, 500));
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      console.log("[agent] No tool calls — agent finished.");
      return;
    }

    for (const toolCall of message.tool_calls) {
      const { name, arguments: argsRaw } = toolCall.function;
      const args = JSON.parse(argsRaw) as Record<string, string>;

      console.log(`[tool] ${name}(${JSON.stringify(args)})`);

      let result: string;
      if (name === "shell_command") {
        result = await shellCommand(args.cmd);
      } else if (name === "submit_answer") {
        result = await submitAnswer(args.confirmation_code);
        console.log("[submit]", result);
      } else {
        result = `Unknown tool: ${name}`;
      }

      const MAX_RESULT = 8000;
      const truncated = result.length > MAX_RESULT
        ? result.slice(0, MAX_RESULT) + `\n[TRUNCATED — original length: ${result.length} chars]`
        : result;

      console.log(`[result] ${result.slice(0, 400)}${result.length > 400 ? "…" : ""}`);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: truncated,
      });
    }

    if (response.choices[0].finish_reason === "stop") {
      console.log("[agent] Finish reason: stop.");
      return;
    }
  }

  console.log("[agent] Max turns reached.");
}

runAgent().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
