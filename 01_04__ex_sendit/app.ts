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

const DOC_BASE_URL = "https://hub.ag3nts.org/dane/doc";
const HUB_URL = "https://hub.ag3nts.org/verify";
const MODEL = "openai/gpt-4.1-mini";

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          { type: "text", text: userPrompt },
        ],
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// ─── STEP 1: Fetch documentation ─────────────────────────────────────────────

console.log("\n━━━ STEP 1: Fetching documentation ━━━");

const [declarationTemplate, blockedRoutesImage] = await Promise.all([
  fetchText(`${DOC_BASE_URL}/zalacznik-E.md`).then((text) => {
    console.log("✓ Declaration template fetched (zalacznik-E.md)");
    return text;
  }),
  fetchImageAsBase64(`${DOC_BASE_URL}/trasy-wylaczone.png`).then((img) => {
    console.log("✓ Blocked routes image fetched (trasy-wylaczone.png)");
    return img;
  }),
]);

console.log("\n--- Declaration template raw content ---");
console.log(declarationTemplate);

// ─── STEP 2: Extract route code from image (vision) ──────────────────────────

console.log("\n━━━ STEP 2: Extracting route code from blocked routes image ━━━");

const routeCodeRaw = await askLLMWithImage(
  "You are analyzing a table of blocked/disabled train routes in a fictional railway system. Extract all route codes and their descriptions from the image. Return them as plain text.",
  "List every route code and its description (route name/cities) from this image. I need the route code for Gdańsk to Żarnowiec specifically.",
  blockedRoutesImage.base64,
  blockedRoutesImage.mimeType
);

console.log("Vision response:\n", routeCodeRaw);

const routeCode = await askLLM(
  "You extract a single route code from text. Return ONLY the route code (e.g. X-01), nothing else.",
  `From this list of blocked routes, extract the route code for the route between Gdańsk and Żarnowiec:\n\n${routeCodeRaw}`
);

console.log("Route code for Gdańsk → Żarnowiec:", routeCode.trim());

// ─── STEP 3: Fill in the declaration ─────────────────────────────────────────

console.log("\n━━━ STEP 3: Filling in the declaration ━━━");

const shipmentData = {
  sender: "450202122",
  origin: "Gdańsk",
  destination: "Żarnowiec",
  routeCode: routeCode.trim(),
  category: "A",
  contentDescription: "kasety z paliwem do reaktora",
  weightKg: 2800,
  // Category A: 0 PP (paid by System), no special notes
  totalCost: "0 PP",
  specialNotes: "",
};

const filledDeclaration = await askLLM(
  `You are filling in a shipment declaration form for the SPK (System Przesyłek Konduktorskich) railway system.
Fill in the declaration EXACTLY according to the template format - preserve all separators (dashes), field names, spacing, and line breaks.
Use the provided shipment data to fill in each field.
For WDP (Wagon Dodatkowy Płatny), calculate: standard train holds 1000 kg (2 wagons × 500 kg), each additional wagon = 500 kg. For 2800 kg: need ceil(2800/500) = 6 wagons total, so WDP = 4 additional wagons. For Category A, cost is 0 PP.
For the date field use today's date: 2026-03-12.
For KWOTA DO ZAPŁATY: Category A is financed by the System (0 PP).
UWAGI SPECJALNE: leave empty (no special notes).
Return ONLY the filled declaration text, nothing else.`,
  `Template:\n${declarationTemplate}\n\nShipment data:\n${JSON.stringify(shipmentData, null, 2)}`
);

console.log("\n--- Filled declaration ---");
console.log(filledDeclaration);

// ─── STEP 4: Submit to Hub ────────────────────────────────────────────────────

console.log("\n━━━ STEP 4: Submitting to Hub ━━━");

const hubPayload = {
  apikey: AI_DEVS_KEY,
  task: "sendit",
  answer: {
    declaration: filledDeclaration,
  },
};

const hubResponse = await fetch(HUB_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(hubPayload),
});

const hubResult = await hubResponse.json();

console.log("\nHub response:");
console.log(JSON.stringify(hubResult, null, 2));

if (hubResult.code === 0) {
  console.log("\n✅ SUCCESS:", hubResult.message);
} else {
  console.log("\n❌ Error from Hub:", hubResult.message ?? hubResult.note);
  console.log("Review the response and adjust the declaration accordingly.");
}
