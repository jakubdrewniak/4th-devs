import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import OpenAI from "openai";
import ngrok from "@ngrok/ngrok";

// ─── Load .env from project root ─────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CSV_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "s03e04_csv");
const PORT = 3456;
const MODEL = "openai/gpt-4.1-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemIndex = Map<string, Set<string>>; // itemName → Set<cityName>

// ─── STEP 1: Read and index CSV files ────────────────────────────────────────

function parseCSV(content: string): string[][] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function readCSV(filename: string): { headers: string[]; rows: string[][] } {
  const filePath = path.join(CSV_DIR, filename);
  const rows = parseCSV(readFileSync(filePath, "utf-8"));
  return { headers: rows[0], rows: rows.slice(1) };
}

function buildIndex(): ItemIndex {
  console.log(`\n━━━ STEP 1: Building index from CSV files ━━━`);

  const citiesCSV = readCSV("cities.csv");
  const cityCodeToName = new Map<string, string>();
  for (const [name, code] of citiesCSV.rows) {
    if (name && code) cityCodeToName.set(code, name);
  }
  console.log(`  cities loaded: ${cityCodeToName.size}`);

  const itemsCSV = readCSV("items.csv");
  const itemCodeToName = new Map<string, string>();
  for (const [name, code] of itemsCSV.rows) {
    if (!name || !code) continue;
    if (itemCodeToName.has(code)) {
      console.warn(`  [WARN] duplicate code "${code}": keeping "${itemCodeToName.get(code)}", ignoring "${name}"`);
      continue;
    }
    itemCodeToName.set(code, name);
  }
  console.log(`  items loaded: ${itemCodeToName.size}`);

  const connectionsCSV = readCSV("connections.csv");
  const index: ItemIndex = new Map();

  for (const [itemCode, cityCode] of connectionsCSV.rows) {
    const itemName = itemCodeToName.get(itemCode);
    const cityName = cityCodeToName.get(cityCode);
    if (!itemName || !cityName) continue;
    if (!index.has(itemName)) index.set(itemName, new Set());
    index.get(itemName)!.add(cityName);
  }

  console.log(`  index built: ${index.size} unique items`);

  return index;
}

// ─── STEP 2: Search tool ──────────────────────────────────────────────────────

// Polish stop words to ignore when scoring candidates
const STOP_WORDS = new Set([
  "potrzebuję", "chcę", "szukam", "proszę", "daj", "podaj", "gdzie",
  "kupić", "nabyć", "znaleźć", "jest", "są", "który", "która", "które",
  "i", "w", "z", "do", "na", "o", "a", "lub", "albo", "mi", "nam", "pod"
]);

function scoreCandidates(query: string, allItems: string[]): string[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // For each query word generate variants: original + stem (drop last 2 chars for Polish declension)
  const queryVariants = queryWords.flatMap((w) => {
    const stem = w.length > 5 ? w.slice(0, -2) : w;
    return [w, stem];
  });

  const scored = allItems.map((item) => {
    const itemLower = item.toLowerCase();
    const score = queryVariants.filter((v) => itemLower.includes(v)).length;
    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((s) => s.item);
}

async function findBestMatch(query: string, index: ItemIndex): Promise<string | null> {
  const allItems = [...index.keys()];
  const candidates = scoreCandidates(query, allItems);

  console.log(`  [match] query="${query}"`);
  console.log(`  [match] keyword candidates (${candidates.length}): ${candidates.slice(0, 5).join(" | ")}${candidates.length > 5 ? "..." : ""}`);

  if (candidates.length === 0) {
    console.log(`  [match] no keyword candidates, returning null`);
    return null;
  }

  if (candidates.length === 1) {
    console.log(`  [match] single candidate, returning directly: "${candidates[0]}"`);
    return candidates[0];
  }

  const candidateList = candidates.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You match a natural language query to the best item from a list. " +
          "Reply with ONLY the exact item name from the list, nothing else. " +
          "If nothing matches, reply with: NO_MATCH",
      },
      {
        role: "user",
        content: `Query: "${query}"\n\nCandidates:\n${candidateList}`,
      },
    ],
  });

  const matched = response.choices[0].message.content?.trim() ?? "NO_MATCH";
  console.log(`  [match] LLM selected: "${matched}"`);

  if (matched === "NO_MATCH" || !index.has(matched)) return null;
  return matched;
}

function buildOutput(cities: Set<string>): string {
  const list = [...cities].join(", ");
  const output = `Cities: ${list}`;
  // Ensure ≤ 500 bytes — truncate if needed
  const encoded = Buffer.from(output, "utf-8");
  if (encoded.length <= 500) return output;
  // Truncate city list to fit
  let result = "Cities: ";
  for (const city of cities) {
    const candidate = result + (result === "Cities: " ? "" : ", ") + city;
    if (Buffer.byteLength(candidate, "utf-8") > 490) break;
    result = candidate;
  }
  return result;
}

function startServer(index: ItemIndex): void {
  const server = createServer(async (req, res) => {
    const sendJson = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(payload);
    };

    if (req.method === "GET") {
      sendJson(200, { status: "ok" });
      return;
    }

    if (req.method !== "POST") {
      sendJson(405, { error: "Method Not Allowed" });
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      let body: { params?: string };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        sendJson(400, { error: "Invalid JSON" });
        return;
      }

      const query = body.params;
      if (!query) {
        sendJson(400, { output: "Missing params" });
        return;
      }

      console.log(`\n[/search] params="${query}"`);

      try {
        const matched = await findBestMatch(query, index);

        if (!matched) {
          console.log(`  → no match found`);
          sendJson(200, { output: "No matching item found" });
          return;
        }

        const cities = index.get(matched)!;
        const output = buildOutput(cities);
        const byteLen = Buffer.byteLength(output, "utf-8");
        console.log(`  → matched: "${matched}"`);
        console.log(`  → cities (${cities.size}): ${[...cities].join(", ")}`);
        console.log(`  → output (${byteLen} bytes): "${output}"`);
        sendJson(200, { output });
      } catch (err) {
        console.error(`  → error:`, err);
        sendJson(500, { output: "Internal error" });
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`\n━━━ STEP 2: HTTP server listening on http://localhost:${PORT} ━━━`);
    console.log(`  Test with:`);
    console.log(`  curl -X POST http://localhost:${PORT}/search -H "Content-Type: application/json" -d '{"params":"potrzebuję rezystora"}'`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function startNgrok(): Promise<string> {
  console.log(`\n━━━ STEP 3: Starting ngrok tunnel on port ${PORT} ━━━`);
  const listener = await ngrok.forward({
    addr: PORT,
    authtoken: process.env.NGROK_AUTHTOKEN!,
  });
  const url = listener.url()!;
  console.log(`  Public URL: ${url}`);
  return url;
}

async function registerTools(publicUrl: string): Promise<void> {
  console.log(`\n━━━ STEP 4: Registering tools with hub ━━━`);

  const payload = {
    apikey: process.env.AI_DEVS_KEY!,
    task: "negotiations",
    answer: {
      tools: [
        {
          URL: `${publicUrl}/search`,
          description:
            "Use this tool to find which cities sell a specific item. " +
            "Pass the item description in natural language in the 'params' field (e.g. 'green LED 5mm' or 'ceramic capacitor 10pF'). " +
            "Returns a list of city names that sell the item.",
        },
      ],
    },
  };

  console.log(`  Payload: ${JSON.stringify(payload, null, 2)}`);

  const res = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  console.log(`  Hub response: ${JSON.stringify(result, null, 2)}`);
}

async function main() {
  const index = buildIndex();
  startServer(index);
  const publicUrl = await startNgrok();
  console.log(`\n  Tool endpoint ready at: ${publicUrl}/search`);
  await registerTools(publicUrl);
}

main().catch(console.error);
