import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// --- Types ---

interface SensorReading {
  sensor_type: string;
  timestamp: number;
  temperature_K: number;
  pressure_bar: number;
  water_level_meters: number;
  voltage_supply_v: number;
  humidity_percent: number;
  operator_notes: string;
}

// --- Sensor validation config ---

type SensorKey = keyof Omit<SensorReading, "sensor_type" | "timestamp" | "operator_notes">;

const SENSOR_MAP: Record<string, { field: SensorKey; min: number; max: number }> = {
  temperature: { field: "temperature_K",      min: 553,  max: 873  },
  pressure:    { field: "pressure_bar",        min: 60,   max: 160  },
  water:       { field: "water_level_meters",  min: 5.0,  max: 15.0 },
  voltage:     { field: "voltage_supply_v",    min: 229.0,max: 231.0 },
  humidity:    { field: "humidity_percent",    min: 40.0, max: 80.0  },
};

// --- Step 2: Programmatic validation ---

function validateReading(reading: SensorReading): string | null {
  const activeTypes = new Set(reading.sensor_type.split("/").map((s) => s.trim()));

  for (const [typeName, { field, min, max }] of Object.entries(SENSOR_MAP)) {
    const value = reading[field] as number;
    const isActive = activeTypes.has(typeName);

    if (isActive) {
      // Active sensor must be within range (value of 0 also fails since ranges start above 0)
      if (value < min || value > max) {
        return `active sensor "${typeName}" value ${value} out of range [${min}, ${max}]`;
      }
    } else {
      // Inactive sensor must be exactly 0
      if (value !== 0) {
        return `inactive sensor "${typeName}" has non-zero value ${value}`;
      }
    }
  }

  return null; // no programmatic anomaly
}

function runProgrammaticValidation(sensorsDir: string): {
  anomalies: Map<string, string>;
  clean: string[];
} {
  const files = readdirSync(sensorsDir).filter((f) => f.endsWith(".json"));
  console.log(`[step2] Loaded ${files.length} sensor files`);

  const anomalies = new Map<string, string>(); // id -> reason
  const clean: string[] = [];

  for (const filename of files) {
    const id = filename.replace(".json", "");
    const raw = readFileSync(path.join(sensorsDir, filename), "utf-8");
    const reading: SensorReading = JSON.parse(raw);

    const reason = validateReading(reading);
    if (reason) {
      anomalies.set(id, reason);
    } else {
      clean.push(id);
    }
  }

  return { anomalies, clean };
}

// --- Step 3: LLM analysis of operator notes (Option B — semantic clustering) ---

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Fetch embeddings in batches of 100 to stay within API limits
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const EMBED_BATCH = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    console.log(`[step3] Embedding batch ${Math.floor(i / EMBED_BATCH) + 1}/${Math.ceil(texts.length / EMBED_BATCH)}...`);

    const response = await openai.embeddings.create({
      model: "openai/text-embedding-3-small",
      input: batch,
    });

    // OpenRouter returns embeddings sorted by index
    const sorted = response.data.sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
  }

  return results;
}

// Greedy clustering: assign each note to the first cluster whose representative
// has cosine similarity >= THRESHOLD; otherwise start a new cluster.
const SIMILARITY_THRESHOLD = 0.92;

function clusterBySimilarity(
  notes: string[],
  embeddings: number[][]
): Map<number, number[]> {
  // clusterIndex -> list of note indices in that cluster
  const clusters = new Map<number, number[]>();
  const clusterEmbeddings: number[][] = [];

  for (let i = 0; i < notes.length; i++) {
    let assigned = false;

    for (let c = 0; c < clusterEmbeddings.length; c++) {
      if (cosine(embeddings[i], clusterEmbeddings[c]) >= SIMILARITY_THRESHOLD) {
        clusters.get(c)!.push(i);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      const newCluster = clusterEmbeddings.length;
      clusterEmbeddings.push(embeddings[i]);
      clusters.set(newCluster, [i]);
    }
  }

  return clusters;
}

// Ask the LLM if a single representative note reports a problem.
// Sending one note at a time for maximum accuracy after clustering reduces the count.
async function classifyNotesBatch(notes: string[]): Promise<number[]> {
  const numbered = notes.map((note, i) => `${i + 1}. "${note}"`).join("\n");

  const prompt = `You are reviewing operator notes from an industrial sensor system.
For each note, decide if the operator is signalling ANY concern — including: detected anomaly, reading out of range, recommended recheck, flagged for review, expressed doubt, or reported anything unusual.
Notes that say everything is fine are NOT anomalies.
Respond ONLY with a JSON array of 1-based indices of problematic notes. If none, respond [].

Notes:
${numbered}`;

  const response = await openai.chat.completions.create({
    model: "openai/gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  const content = response.choices[0].message.content ?? "[]";
  const cleaned = content.replace(/```(?:json)?\s*/g, "").trim();
  return JSON.parse(cleaned) as number[];
}

async function runLlmAnalysis(cleanIds: string[], sensorsDir: string): Promise<string[]> {
  // Collect all notes and build note -> file IDs map
  const noteToIds = new Map<string, string[]>();
  for (const id of cleanIds) {
    const raw = readFileSync(path.join(sensorsDir, `${id}.json`), "utf-8");
    const reading: SensorReading = JSON.parse(raw);
    const note = reading.operator_notes.trim();
    const existing = noteToIds.get(note);
    if (existing) existing.push(id);
    else noteToIds.set(note, [id]);
  }

  const uniqueNotes = [...noteToIds.keys()];
  console.log(`[step3] Unique notes (exact): ${uniqueNotes.length} from ${cleanIds.length} files`);

  // Option B: embed all unique notes and cluster semantically
  const embeddings = await getEmbeddings(uniqueNotes);
  const clusters = clusterBySimilarity(uniqueNotes, embeddings);
  console.log(`[step3] Semantic clusters: ${clusters.size} (threshold: ${SIMILARITY_THRESHOLD})`);

  // For each cluster, classify only the representative (index 0 in cluster = earliest note)
  const BATCH_SIZE = 20;
  const clusterIndices = [...clusters.keys()];
  const representatives = clusterIndices.map((c) => uniqueNotes[clusters.get(c)![0]]);

  const anomalousIds: string[] = [];

  for (let i = 0; i < representatives.length; i += BATCH_SIZE) {
    const batch = representatives.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(representatives.length / BATCH_SIZE);
    console.log(`[step3] Classifying batch ${batchNum}/${totalBatches} (${batch.length} representatives)...`);

    const badIndices = await classifyNotesBatch(batch);

    for (const idx of badIndices) {
      // idx is 1-based within the batch → map back to cluster
      const clusterIdx = clusterIndices[i + idx - 1];
      const noteIndicesInCluster = clusters.get(clusterIdx)!;

      // All notes in this cluster share the same semantic meaning → all are anomalous
      for (const noteIdx of noteIndicesInCluster) {
        const note = uniqueNotes[noteIdx];
        const ids = noteToIds.get(note) ?? [];
        anomalousIds.push(...ids);
      }
    }
  }

  return anomalousIds;
}

// --- Main ---

async function main() {
  const SENSORS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "sensors");

  // Step 2: programmatic validation
  const { anomalies, clean } = runProgrammaticValidation(SENSORS_DIR);
  console.log(`[step2] Programmatic anomalies found: ${anomalies.size}`);
  console.log(`[step2] Files passing validation (to be checked by LLM): ${clean.length}`);

  // Step 3: LLM analysis of operator notes for "clean" files
  const llmAnomalies = await runLlmAnalysis(clean, SENSORS_DIR);
  console.log(`[step3] LLM anomalies found: ${llmAnomalies.length}`);

  // Merge both sets
  const allAnomalies = new Set([...anomalies.keys(), ...llmAnomalies]);
  console.log(`[result] Total anomalies: ${allAnomalies.size}`);
  console.log(`[result] IDs:`, [...allAnomalies].sort());
  console.log(`[result] anomalies IDs:`, [...anomalies.keys()].sort());
  console.log(`[result] llmAnomalies:`, [...llmAnomalies].sort());

  // Step 4: send answer to Centrala
  const answer = [...allAnomalies].sort();
  const payload = { apikey: AI_DEVS_KEY, task: "evaluation", answer: { recheck: answer } };

  console.log("[step4] Sending answer to Centrala...");
  const res = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log("[step4] Response:", JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("[error]", err.message);
  process.exit(1);
});



[
  "0158", "0307", "0516", "0567", "0753",
  "1053", "1269", "1632", "1678", "1743",
  "1819", "2044", "2175", "2238", "2500",
  "2958", "3123", "3713", "3798", "4040",
  "4186", "4237", "4630", "4673", "4888",
  "5000", "5022", "5156", "5405", "5714",
  "5715", "5799", "6197", "6281", "6336",
  "7266", "7680", "7701", "8076", "8168",
  "8369", "8410", "8457", "9151", "9288",
  "9422", "9518", "9583", "9604", "9614",
  "9717", "9848"
]
