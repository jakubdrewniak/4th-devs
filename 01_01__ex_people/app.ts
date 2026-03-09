import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from project root
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
if (!AI_DEVS_KEY) {
  console.error("Error: AI_DEVS_KEY not found in .env");
  process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Person {
  name: string;
  surname: string;
  gender: string;
  birthDate: string;
  birthPlace: string;
  birthCountry: string;
  job: string;
}

// ─── CSV parser (handles quoted fields) ──────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// ─── Step 1: Fetch & parse CSV ───────────────────────────────────────────────

async function fetchPeople(): Promise<Person[]> {
  const url = `https://hub.ag3nts.org/data/${AI_DEVS_KEY}/people.csv`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const text = await res.text();
  const lines = text.trim().split("\n");

  const [_header, ...rows] = lines;

  return rows.map((line) => {
    const cols = parseCsvLine(line);
    const [name, surname, gender, birthDate, birthPlace, birthCountry, job] = cols;
    return {
      name: name.trim(),
      surname: surname.trim(),
      gender: gender.trim(),
      birthDate: birthDate.trim(),
      birthPlace: birthPlace.trim(),
      birthCountry: birthCountry.trim(),
      job: (job ?? "").trim(),
    };
  });
}

// ─── Step 2: Filter ──────────────────────────────────────────────────────────

const CURRENT_YEAR = 2026;

function filterPeople(people: Person[]): Person[] {
  return people.filter((p) => {
    if (p.gender !== "M") return false;
    if (p.birthPlace !== "Grudziądz") return false;
    const birthYear = new Date(p.birthDate).getFullYear();
    const age = CURRENT_YEAR - birthYear;
    return age >= 20 && age <= 40;
  });
}

// ─── Step 3: LLM tagging ─────────────────────────────────────────────────────

const AI_API_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const API_ENDPOINT = "https://openrouter.ai/api/v1/responses";
const MODEL = "openai/gpt-4.1-mini";

const VALID_TAGS = ["IT", "transport", "edukacja", "medycyna", "praca z ludźmi", "praca z pojazdami", "praca fizyczna"] as const;
type Tag = typeof VALID_TAGS[number];

interface TaggedPerson {
  name: string;
  surname: string;
  gender: string;
  born: number;
  city: string;
  tags: Tag[];
}

const taggingSchema = {
  type: "json_schema",
  name: "people_tags",
  strict: true,
  schema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            surname: { type: "string" },
            tags: {
              type: "array",
              items: {
                type: "string",
                enum: [...VALID_TAGS]
              }
            }
          },
          required: ["name", "surname", "tags"],
          additionalProperties: false
        }
      }
    },
    required: ["people"],
    additionalProperties: false
  }
};

async function tagPeople(people: Person[]): Promise<TaggedPerson[]> {
  const list = people.map((p, i) =>
    `${i + 1}. ${p.name} ${p.surname}: ${p.job}`
  ).join("\n");

  const prompt = `Przypisz każdej osobie jeden lub więcej tagów na podstawie opisu zawodu.
Dostępne tagi: IT, transport, edukacja, medycyna, praca z ludźmi, praca z pojazdami, praca fizyczna.

Osoby:
${list}`;

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      text: { format: taggingSchema }
    })
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  }

  const outputText: string =
    data.output_text ??
    data.output
      ?.filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content)
      .find((c: any) => c.type === "output_text")?.text ?? "";

  const parsed = JSON.parse(outputText) as { people: { name: string; surname: string; tags: Tag[] }[] };

  return people.map((p) => {
    const match = parsed.people.find(
      (x) => x.name === p.name && x.surname === p.surname
    );
    return {
      name: p.name,
      surname: p.surname,
      gender: p.gender,
      born: new Date(p.birthDate).getFullYear(),
      city: p.birthPlace,
      tags: match?.tags ?? []
    };
  });
}

// ─── Step 4: Submit answer ───────────────────────────────────────────────────

async function submitAnswer(answer: TaggedPerson[]): Promise<void> {
  const payload = {
    apikey: AI_DEVS_KEY,
    task: "people",
    answer
  };

  console.log("\nSubmitting to https://hub.ag3nts.org/verify...");

  const res = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const people = await fetchPeople();
  console.log(`Total people fetched: ${people.length}`);

  const filtered = filterPeople(people);
  console.log(`Filtered (men, Grudziądz, age 20-40): ${filtered.length}`);

  console.log("Tagging with LLM...");
  const tagged = await tagPeople(filtered);

  const withTransport = tagged.filter((p) => p.tags.includes("transport"));
  console.log(`\nWith 'transport' tag: ${withTransport.length}`);
  console.log(JSON.stringify(withTransport, null, 2));

  await submitAnswer(withTransport);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
