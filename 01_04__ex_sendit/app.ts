import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import OpenAI from "openai";

// ─── Load .env from project root ─────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const AI_DEVS_KEY = process.env.AI_DEVS_KEY!;

const DOC_INDEX_URL = "https://hub.ag3nts.org/dane/doc/index.md";
const DOC_BASE_URL = "https://hub.ag3nts.org/dane/doc";
const HUB_URL = "https://hub.ag3nts.org/verify";
const MODEL = "openai/gpt-4.1-mini";

const SHIPMENT = {
  sender: "450202122",
  origin: "Gdańsk",
  destination: "Żarnowiec",
  category: "A",
  contentDescription: "kasety z paliwem do reaktora",
  weightKg: 2800,
  totalCost: "0 PP",
  specialNotes: "",
  date: "2026-03-12",
};

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Types ────────────────────────────────────────────────────────────────────

type TextDoc = { type: "text"; url: string; content: string };
type ImageDoc = { type: "image"; url: string; base64: string; mimeType: string };
type Doc = TextDoc | ImageDoc;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = res.headers.get("content-type") ?? "image/png";
  return { base64, mimeType };
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

async function askLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0].message.content ?? "";
}

async function askLLMWithImage(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  mimeType: string
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: "text", text: userPrompt },
        ],
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// ─── STEP 1: Fetch all documentation from index.md ───────────────────────────

async function fetchAllDocs(): Promise<Doc[]> {
  console.log(`Fetching index: ${DOC_INDEX_URL}`);
  const indexContent = await fetchText(DOC_INDEX_URL);

  // Use LLM to extract all referenced file names from the index
  const extractedRaw = await askLLM(
    "You extract file names from documentation. Return ONLY a JSON array of file name strings (e.g. [\"file1.md\", \"image.png\"]), nothing else.",
    `Extract all referenced file names (with extensions like .md, .png, .jpg) from this document:\n\n${indexContent}`
  );

  const linkedFiles: string[] = JSON.parse(extractedRaw.trim());
  console.log(`Found ${linkedFiles.length} linked files:`, linkedFiles);

  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

  const docs = await Promise.all(
    linkedFiles.map(async (file): Promise<Doc> => {
      const url = `${DOC_BASE_URL}/${file}`;
      const isImage = IMAGE_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext));

      if (isImage) {
        const { base64, mimeType } = await fetchImageAsBase64(url);
        console.log(`  ✓ image: ${file}`);
        return { type: "image", url, base64, mimeType };
      } else {
        const content = await fetchText(url);
        console.log(`  ✓ text:  ${file}`);
        return { type: "text", url, content };
      }
    })
  );

  return docs;
}

// ─── STEP 2: Find declaration template ───────────────────────────────────────

async function findDeclarationTemplate(docs: Doc[]): Promise<string> {
  const textDocs = docs.filter((d): d is TextDoc => d.type === "text");

  const docSummaries = textDocs
    .map((d, i) => `[${i}] URL: ${d.url}\nContent preview:\n${d.content.slice(0, 300)}`)
    .join("\n\n---\n\n");

  const indexRaw = await askLLM(
    "You identify which document is a shipment declaration form template. Return ONLY the index number (0, 1, 2, ...), nothing else.",
    `Which of these documents is the declaration form template (wzór deklaracji / formularz)?\n\n${docSummaries}`
  );

  const index = parseInt(indexRaw.trim(), 10);
  const template = textDocs[index];
  console.log(`Declaration template identified: ${template.url}`);
  console.log("\n--- Template content ---\n" + template.content);

  return template.content;
}

// ─── STEP 3: Extract route code from images ───────────────────────────────────

async function extractRouteCode(docs: Doc[]): Promise<string> {
  const imageDocs = docs.filter((d): d is ImageDoc => d.type === "image");

  for (const img of imageDocs) {
    console.log(`Scanning image for route codes: ${img.url}`);

    const allRoutes = await askLLMWithImage(
      "You analyze tables of train route codes. Extract all route codes and associated city names. Return plain text.",
      "List all route codes and their city pairs from this image.",
      img.base64,
      img.mimeType
    );

    console.log("Vision response:\n", allRoutes);

    if (allRoutes.toLowerCase().includes("gdańsk") || allRoutes.toLowerCase().includes("żarnowiec")) {
      const routeCode = await askLLM(
        "You extract a single route code from text. Return ONLY the route code (e.g. X-01), nothing else.",
        `From this list of routes, extract the route code for Gdańsk → Żarnowiec:\n\n${allRoutes}`
      );
      console.log(`Route code for Gdańsk → Żarnowiec: ${routeCode.trim()}`);
      return routeCode.trim();
    }
  }

  throw new Error("Route code for Gdańsk → Żarnowiec not found in any image");
}

// ─── STEP 4: Fill in the declaration ─────────────────────────────────────────

async function fillDeclaration(template: string, routeCode: string): Promise<string> {
  const shipmentData = { ...SHIPMENT, routeCode };

  const filled = await askLLM(
    `You fill in a shipment declaration form (SPK - System Przesyłek Konduktorskich).
Rules:
- Preserve ALL separators, field names, spacing, and line breaks exactly as in the template.
- For WDP (Wagon Dodatkowy Płatny): each wagon holds 500 kg, standard = 2 wagons (1000 kg). For 2800 kg: ceil(2800/500)=6 wagons total, WDP=4.
- Category A cost is 0 PP (financed by System).
- UWAGI SPECJALNE: leave empty.
- Return ONLY the filled declaration text, nothing else.`,
    `Template:\n${template}\n\nShipment data:\n${JSON.stringify(shipmentData, null, 2)}`
  );

  console.log("\n--- Filled declaration ---\n" + filled);
  return filled;
}

// ─── STEP 5: Submit to Hub ────────────────────────────────────────────────────

async function submitToHub(declaration: string): Promise<void> {
  const payload = {
    apikey: AI_DEVS_KEY,
    task: "sendit",
    answer: { declaration },
  };

  const res = await fetch(HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  console.log("\nHub response:\n" + JSON.stringify(result, null, 2));

  if (result.code === 0) {
    console.log("\n✅ SUCCESS:", result.message);
  } else {
    console.log("\n❌ Error:", result.message ?? result.note);
    console.log("Review the declaration and adjust accordingly.");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n━━━ STEP 1: Fetching all documentation ━━━");
  const docs = await fetchAllDocs();

  console.log("\n━━━ STEP 2: Finding declaration template ━━━");
  const template = await findDeclarationTemplate(docs);

  console.log("\n━━━ STEP 3: Extracting route code ━━━");
  const routeCode = await extractRouteCode(docs);

  console.log("\n━━━ STEP 4: Filling declaration ━━━");
  const declaration = await fillDeclaration(template, routeCode);

  console.log("\n━━━ STEP 5: Submitting to Hub ━━━");
  await submitToHub(declaration);
}

main().catch(console.error);