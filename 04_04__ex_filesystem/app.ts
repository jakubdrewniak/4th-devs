import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

// ─── Env setup ───────────────────────────────────────────────────────────────

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
const TASK = "filesystem";
const NOTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "natan_notes");
const MODEL = "openai/gpt-4.1-mini";

const openai = new OpenAI({ apiKey: OPENROUTER_KEY, baseURL: "https://openrouter.ai/api/v1" });

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedData {
  miasta: Record<string, Record<string, number>>;        // miasto -> { towar -> ilość }
  osoby: Record<string, { imie_nazwisko: string; miasto: string }>;   // klucz_pliku -> dane
  towary: Record<string, string[]>;                      // towar (mianownik) -> lista WSZYSTKICH miast sprzedawców
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function transliterate(s: string): string {
  return s
    .replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e")
    .replace(/ł/g, "l").replace(/ń/g, "n").replace(/ó/g, "o")
    .replace(/ś/g, "s").replace(/ź/g, "z").replace(/ż/g, "z")
    .toLowerCase().trim();
}

// Plurals / non-nominative forms that appear in transakcje.txt
const ITEM_NORMALIZE: Record<string, string> = {
  ziemniaki: "ziemniak",
};

function parseTransakcje(rawTransakcje: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const line of rawTransakcje.split("\n")) {
    const parts = line.split("->").map((s) => s.trim());
    if (parts.length !== 3) continue;
    const [seller, rawItem] = parts;
    const itemKey = transliterate(rawItem);
    const item = ITEM_NORMALIZE[itemKey] ?? itemKey;
    const sellerNorm = seller.trim();
    if (!result[item]) result[item] = [];
    if (!result[item].includes(sellerNorm)) result[item].push(sellerNorm);
  }
  return result;
}

async function extractData(notes: string): Promise<ExtractedData> {
  // towary: parsed deterministically from transakcje.txt — no LLM confusion about buyer/seller direction
  const transakcjeSection = notes.match(/=== transakcje\.txt ===([\s\S]*?)(?:===|$)/)?.[1] ?? "";
  const towary = parseTransakcje(transakcjeSection);

  // miasta + osoby: extracted by LLM from natural language notes
  const prompt = `Masz notatki Natana dotyczące handlu między miastami. Wyekstrahuj z nich dane do JSON.

ZASADY OGÓLNE:
- Bez polskich znaków (ą→a, ę→e, ó→o, ś→s, ł→l, ź→z, ż→z, ć→c, ń→n)
- Nazwy miast w mianowniku (np. "Darzlubie", "Mechowo")

ZASADY DLA TOWARÓW W MIASTACH:
- Zawsze mianownik liczby pojedynczej, jedno słowo, bez jednostek i kontekstu
- POPRAWNIE: "kilof", "lopata", "ryz", "chleb", "woda", "wiertarka", "mlotek", "wolowina", "kurczak", "ziemniak", "kapusta", "marchew", "makaron", "maka"
- NIEPOPRAWNIE: "butelka_wody", "porcja_wolowiny", "porcja_kurczaka", "worko_ryz"

ZASADY DLA OSÓB:
- Jedna osoba na miasto — ta która zarządza lub odpowiada za handel w danym mieście
- Jeśli z kontekstu wynika że dwie wzmianki to ta sama osoba — traktuj jako jedną
- Jeśli znane jest tylko imię lub tylko nazwisko — użyj tego co jest
- Klucz pliku = imię i/lub nazwisko z podkreśleniem zamiast spacji (np. "Natan_Rams", "Lena_Konkel")

SKĄD BRAĆ DANE:
- "miasta" → ogłoszenia.txt (co miasto potrzebuje i ile, bez jednostek)
- "osoby" → rozmowy.txt (kto zarządza którym miastem)

STRUKTURA ODPOWIEDZI (tylko czysty JSON):
{
  "miasta": { "NazwaMiasta": { "towar": liczba } },
  "osoby": { "klucz_pliku": { "imie_nazwisko": "Imie Nazwisko", "miasto": "NazwaMiasta" } }
}

NOTATKI:
${notes}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "{}";
  const llmData = JSON.parse(raw) as Pick<ExtractedData, "miasta" | "osoby">;
  return { ...llmData, towary };
}

function loadNotes(): string {
  const files = ["README.md", "ogłoszenia.txt", "rozmowy.txt", "transakcje.txt"];
  return files.map((f) => {
    const full = path.join(NOTES_DIR, f);
    const content = readFileSync(full, "utf-8");
    return `=== ${f} ===\n${content}`;
  }).join("\n\n");
}

async function callApi(answer: unknown): Promise<unknown> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  const data = await res.json();
  return data;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "filesystem_action",
      description: "Executes a single action on the virtual filesystem API. Use this to createDirectory, createFile, listFiles, reset, or done.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["createDirectory", "createFile", "listFiles", "deleteFile", "deleteDirectory", "reset", "done"],
            description: "The action to perform.",
          },
          path: {
            type: "string",
            description: "Path for the action (e.g. /miasta or /miasta/opalino). File names must match ^[a-z0-9_]+$, max 20 chars. No extensions.",
          },
          content: {
            type: "string",
            description: "Content of the file (only for createFile). Only markdown syntax. Markdown links must point to existing files.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(data: ExtractedData): string {
  return `You are a filesystem agent. Your job is to build a specific directory structure in a virtual filesystem API.

EXTRACTED DATA:
${JSON.stringify(data, null, 2)}

YOUR TASK:
Build the following structure using filesystem_action tool calls:

1. Reset the filesystem first (action: reset)
2. Create three directories: /miasta, /osoby, /towary
3. For each city in "miasta": create file /miasta/<cityname_lowercase> with JSON content of goods needed:
   Example content: {"chleb": 45, "woda": 120, "mlotek": 6}
4. For each person in "osoby": create file /osoby/<key_lowercase> with their name and a markdown link to their city:
   Example content: Iga Kapecka\\n\\n[Opalino](/miasta/opalino)
5. For each item in "towary": create file /towary/<item_lowercase> with markdown links to ALL cities in the list.
   Each item has an array of seller cities — include every one as a separate markdown link.
   Example for ["Domatowo","Brudzewo"]: [Domatowo](/miasta/domatowo)\\n[Brudzewo](/miasta/brudzewo)
6. Call done when finished and keep calling done after each fix until the response has code 0.

IMPORTANT RULES:
- All file/directory names must be lowercase, only [a-z0-9_], max 20 chars, no extensions
- Markdown links must point to already-created files (create /miasta files before /osoby and /towary)
- NEVER ask questions or wait for input — always act autonomously
- If API returns an error, read the error carefully and fix it immediately with another tool call
- If done returns an error about missing people, add the missing person to /osoby linked to the city that matches their name
- If done returns an error about missing seller cities for a good, update that /towary file to include all missing cities
- Keep calling done after every fix until you receive code 0`;
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgent(data: ExtractedData): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(data) },
    { role: "user", content: "Build the filesystem structure now. Start with reset, then create all directories and files, then call done." },
  ];

  const MAX_STEPS = 60;

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

    if (!msg.tool_calls?.length) {
      console.log("[agent] finished:", msg.content);
      return;
    }

    console.log(`[agent] ${msg.tool_calls.length} tool call(s)`);

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments) as { action: string; path?: string; content?: string };
      console.log(`[agent] → filesystem_action(${JSON.stringify(args)})`);

      const apiResponse = await callApi(args);
      const result = JSON.stringify(apiResponse);
      console.log(`[agent] ← ${result}`);

      const flagMatch = result.match(/\{FLG:[^}]+\}/);
      if (flagMatch) {
        console.log(`[agent] FLAG FOUND: ${flagMatch[0]}`);
        return;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n━━━ STEP 1: Load notes ━━━");
  const notes = loadNotes();
  console.log("[notes] Loaded files, total chars:", notes.length);

  console.log("\n━━━ STEP 2: Extract data via LLM ━━━");
  console.log("[llm] Sending notes to LLM for extraction...");
  const data = await extractData(notes);
  console.log("[llm] Extracted miasta:", Object.keys(data.miasta).join(", "));
  console.log("[llm] Extracted osoby:", Object.keys(data.osoby).join(", "));
  console.log("[llm] Extracted towary:", Object.keys(data.towary).join(", "));

  console.log("\n━━━ STEP 3: Agent builds filesystem ━━━");
  await runAgent(data);
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
