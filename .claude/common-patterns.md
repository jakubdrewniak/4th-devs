# Wspólny schemat skryptów app.ts — AI Devs 4

Dokument opisuje powtarzające się wzorce we wszystkich ćwiczeniach (`**__ex_*/app.ts`).
Używaj go jako punktu startowego przy rozwiązywaniu nowych zadań.

---

## 1. Struktura pliku (kolejność sekcji)

```
// imports
// Load .env from project root      ← zawsze identyczny blok
// Config                           ← klucze API, URL-e, modele
// Types                            ← interfejsy TypeScript
// Helpers / narzędzia              ← funkcje pomocnicze
// Tool implementations             ← implementacje narzędzi agenta
// Tool definitions (dla LLM)       ← tablice `tools[]`
// System prompt                    ← stała SYSTEM / SYSTEM_PROMPT
// Agent loop / main logic
// main()
// main().catch(...)
```

Separatory sekcji: `// ─── Section Name ─────────────────`

---

## 2. Ładowanie .env (IDENTYCZNE we wszystkich plikach)

```typescript
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}
```

---

## 3. Config — klucze i stałe

```typescript
const AI_DEVS_KEY  = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY)    { console.error("[config] Missing AI_DEVS_KEY");    process.exit(1); }
if (!OPENROUTER_KEY) { console.error("[config] Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB   = "https://hub.ag3nts.org";
const MODEL = "openai/gpt-4.1-mini";   // domyślny model agenta
```

### Używane modele

| Zastosowanie              | Model                              |
|---------------------------|------------------------------------|
| Agent ogólny (domyślny)   | `openai/gpt-4.1-mini`              |
| Orchestrator/złożone myśl.| `anthropic/claude-sonnet-4-6`      |
| Tanie zadania / kompresja | `openai/gpt-5.4-nano`              |
| Vision (obraz + tekst)    | `google/gemini-3-flash-preview`    |
| Vision (dokładna)         | `openai/gpt-5.4`                   |
| Embeddingi                | `openai/text-embedding-3-small`    |

---

## 4. Klient OpenAI (OpenRouter)

### Wariant A — OpenAI SDK (zalecany)
```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// Użycie:
const response = await openai.chat.completions.create({
  model: MODEL,
  messages,
  tools,
  tool_choice: "auto",
});
const msg = response.choices[0].message;
```

### Wariant B — raw fetch (starsze ćwiczenia)
```typescript
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` },
  body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
});
const data = await res.json();
if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
const msg = data.choices[0].message;
```

---

## 5. Submit do Hub — wzorzec odpowiedzi

```typescript
async function submitAnswer(answer: unknown): Promise<unknown> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "TASK_NAME", answer }),
  });
  const data = await res.json();
  console.log("Hub response:", JSON.stringify(data, null, 2));
  return data;
}
```

Odpowiedź huba: `{ code: 0|non-0, msg: string, note?: string }`
- `code === 0` → sukces
- w treści może pojawić się flag: `{FLG:...}`

---

## 6. Wykrywanie flagi

```typescript
const flagMatch = JSON.stringify(data).match(/\{FLG:[^}]+\}/);
if (flagMatch) {
  console.log(`[agent] FLAG FOUND: ${flagMatch[0]}`);
  return;
}
```

---

## 7. Definicja narzędzia (tool)

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "tool_name",
      description: "Co robi narzędzie.",
      parameters: {
        type: "object",
        properties: {
          param1: { type: "string", description: "..." },
          param2: { type: "number", description: "..." },
        },
        required: ["param1"],
        additionalProperties: false,
      },
    },
  },
];
```

---

## 8. Pętla agenta (agent loop)

```typescript
const MAX_STEPS = 30;

async function runAgent(): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: "Zadanie startowe." },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n[agent] step ${step}/${MAX_STEPS}`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // Brak wywołań narzędzi → LLM skończył
    if (!msg.tool_calls?.length) {
      console.log(`[agent] finished: ${msg.content}`);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);

      let result: string;

      if (call.function.name === "tool_name") {
        const raw = await myToolImpl(args.param1 as string);
        result = JSON.stringify(raw);

        // Sprawdź flagę po każdym wywołaniu submit
        const flagMatch = result.match(/\{FLG:[^}]+\}/);
        if (flagMatch) {
          console.log(`[agent] FLAG FOUND: ${flagMatch[0]}`);
          return;
        }
      } else {
        result = `Unknown tool: ${call.function.name}`;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}
```

---

## 9. Pobieranie danych z huba

```typescript
// Dane tekstowe
const res = await fetch(`${HUB}/data/${AI_DEVS_KEY}/filename.csv`);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = await res.text();

// Dane JSON
const data = await res.json();

// Obraz → base64
const buffer = await res.arrayBuffer();
const base64  = Buffer.from(buffer).toString("base64");
const mimeType = res.headers.get("content-type") ?? "image/png";
```

---

## 10. Wywołanie LLM z obrazem (vision)

```typescript
// Z URL obrazu (sieciowy)
await openai.chat.completions.create({
  model: MODEL_VISION,
  messages: [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text",      text: "Pytanie do obrazu" },
    ],
  }],
});

// Z base64 (lokalny lub pobrany)
{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
```

---

## 11. Retry + rate limit (wzorzec z 01_05)

```typescript
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 5, baseDelayMs = 2000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.status !== 503 || attempt === retries) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw new Error("unreachable");
}

async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try { return await fn(); }
    catch (err: any) {
      if (err?.status !== 429) throw err;
      await sleep(err.retryAfterMs ?? 30_000);
    }
  }
}
```

---

## 12. HTTP server (ćwiczenia z webhookiem)

Wzorzec z `01_03__ex_mcp` i `03_04__ex_negotiations`:

```typescript
import { createServer } from "node:http";

const server = createServer(async (req, res) => {
  const sendJson = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET")  { sendJson(200, { status: "ok" }); return; }
  if (req.method !== "POST") { sendJson(405, { error: "Method Not Allowed" }); return; }

  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf-8")); }
    catch { sendJson(400, { error: "Invalid JSON" }); return; }

    // obsługa...
    sendJson(200, { output: "wynik" });
  });
});

server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
```

---

## 13. Main + error handler

```typescript
async function main(): Promise<void> {
  // kroki ponumerowane w logach
  console.log("\n━━━ STEP 1: ... ━━━");
  // ...
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
```

---

## 14. Typy zadań i pasujące wzorce

| Typ zadania                        | Wzorzec                          | Przykłady         |
|------------------------------------|----------------------------------|-------------------|
| Pobierz dane → przetwórz → wyślij  | sequential steps + submitAnswer  | 01_01, 01_04      |
| Agent z narzędziami                | agent loop + tools[]             | 01_02, 01_05, 02_01, 02_03, 02_04, 02_05, 03_02 |
| LLM decyduje w każdej turze        | pętla bez tool_calls, direct ask | 03_03             |
| Serwer HTTP + ngrok                | HTTP server + registerTools      | 01_03, 03_04      |
| Vision → analiza → API             | fetchImageAsBase64 + vision LLM  | 01_04, 02_02, 02_05 |
| Embeddingi + clustering            | getEmbeddings + cosine           | 03_01             |

---

## 15. Najczęstsze pułapki

- Zawsze sprawdzaj flagę `{FLG:...}` po każdym wywołaniu submit, nie tylko na końcu.
- Przy agencie: dodaj asystenta (`messages.push(msg)`) **przed** wykonaniem tool calls.
- `additionalProperties: false` w schemacie narzędzia zapobiega błędom OpenAI.
- Przy ładowaniu .env użyj `process.loadEnvFile` (Node 20+), nie `dotenv`.
- Model vision musi mieć obraz **przed** tekstem w `content[]` (lub przynajmniej w tablicy).
