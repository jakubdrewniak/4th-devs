import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Env setup ───────────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) { console.error("Missing AI_DEVS_KEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("Missing OPENROUTER_API_KEY"); process.exit(1); }

const HUB = "https://hub.ag3nts.org";
const MODEL = "openai/gpt-4.1-mini";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PowerPlant { code: string; lat: number; lon: number; }

// ─── Haversine ───────────────────────────────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── City → coordinates map ───────────────────────────────────────────────────

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  "Zabrze":               { lat: 50.3249, lon: 18.7857 },
  "Piotrków Trybunalski": { lat: 51.4047, lon: 19.6979 },
  "Grudziądz":            { lat: 53.4850, lon: 18.7534 },
  "Tczew":                { lat: 53.7774, lon: 18.7780 },
  "Radom":                { lat: 51.4027, lon: 21.1471 },
  "Chelmno":              { lat: 53.3486, lon: 18.4254 },
  "Chełmno":              { lat: 53.3486, lon: 18.4254 },
  "Żarnowiec":            { lat: 54.5859, lon: 18.1540 },
};

// ─── Cached power plants (populated by get_power_plants tool) ─────────────────

let cachedPlants: PowerPlant[] = [];

// ─── Tool handlers ────────────────────────────────────────────────────────────

const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {

  get_suspects() {
    const p = path.join(ROOT_DIR, "01_01__ex_people", "answers.json");
    const people: Array<{ name: string; surname: string; born: number }> = JSON.parse(readFileSync(p, "utf-8"));
    return people.map(({ name, surname, born }) => ({ name, surname, birthYear: born }));
  },

  async get_power_plants() {
    const res = await fetch(`${HUB}/data/${AI_DEVS_KEY}/findhim_locations.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const map: Record<string, any> = data.power_plants ?? data;
    const plants: PowerPlant[] = [];
    for (const [city, info] of Object.entries(map)) {
      const coords = CITY_COORDS[city];
      if (!coords) { console.warn(`Unknown city: ${city}`); continue; }
      plants.push({ code: (info as any).code, lat: coords.lat, lon: coords.lon });
    }
    cachedPlants = plants;
    return plants;
  },

  async get_closest_plant({ name, surname }: { name: string; surname: string }) {
    if (cachedPlants.length === 0) throw new Error("Call get_power_plants first");
    const res = await fetch(`${HUB}/api/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, name, surname }),
    });
    const data = await res.json();
    const locs: any[] = Array.isArray(data) ? data : (data.locations ?? data.answer ?? []);

    let best: { powerPlantCode: string; distanceKm: number } | null = null;
    for (const loc of locs) {
      const lat = loc.latitude ?? loc.lat;
      const lon = loc.longitude ?? loc.lon;
      if (lat == null || lon == null) continue;
      for (const plant of cachedPlants) {
        const d = haversine(lat, lon, plant.lat, plant.lon);
        if (!best || d < best.distanceKm) {
          best = { powerPlantCode: plant.code, distanceKm: d };
        }
      }
    }
    return best ?? { powerPlantCode: null, distanceKm: Infinity };
  },

  async get_access_level({ name, surname, birthYear }: { name: string; surname: string; birthYear: number }) {
    const res = await fetch(`${HUB}/api/accesslevel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, name, surname, birthYear }),
    });
    const data = await res.json();
    if (typeof data === "number") return data;
    return data.accessLevel ?? data.answer ?? data.level ?? 0;
  },

  async submit_answer({ name, surname, accessLevel, powerPlant }: {
    name: string; surname: string; accessLevel: number; powerPlant: string;
  }) {
    const res = await fetch(`${HUB}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "findhim", answer: { name, surname, accessLevel, powerPlant } }),
    });
    const data = await res.json();
    console.log("Submission response:", JSON.stringify(data, null, 2));
    return data;
  },
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "get_suspects",
      description: "Returns the list of suspects (name, surname, birthYear) from the previous exercise.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_power_plants",
      description: "Fetches the list of power plants with their GPS coordinates. Must be called before get_closest_plant.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_closest_plant",
      description: "For a given suspect, fetches all their sighting locations and returns which power plant is closest and the distance in km.",
      parameters: {
        type: "object",
        properties: {
          name:    { type: "string", description: "First name" },
          surname: { type: "string", description: "Last name" },
        },
        required: ["name", "surname"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_access_level",
      description: "Returns the access level for a suspect.",
      parameters: {
        type: "object",
        properties: {
          name:      { type: "string" },
          surname:   { type: "string" },
          birthYear: { type: "number" },
        },
        required: ["name", "surname", "birthYear"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submits the final identified suspect to the hub.",
      parameters: {
        type: "object",
        properties: {
          name:        { type: "string" },
          surname:     { type: "string" },
          accessLevel: { type: "number" },
          powerPlant:  { type: "string", description: "Power plant code, e.g. PWR2758PL" },
        },
        required: ["name", "surname", "accessLevel", "powerPlant"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Agent loop ───────────────────────────────────────────────────────────────

const SYSTEM = `You are a detective agent. Your goal: identify which suspect was spotted closest to a power plant, then submit the answer.

Steps:
1. Call get_suspects and get_power_plants (you may do these in parallel).
2. For every suspect, call get_closest_plant to find their nearest power plant and distance.
3. Identify the suspect whose minimum distance across all their sightings is the smallest overall.
4. Call get_access_level for that suspect.
5. Call submit_answer with their name, surname, accessLevel, and the power plant code.`;

async function runAgent(): Promise<void> {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user",   content: "Find the suspect and submit the answer." },
  ];

  const MAX_STEPS = 50;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);

    const msg = data.choices[0].message;
    messages.push(msg);

    // No tool calls → LLM is done, print final answer
    if (!msg.tool_calls?.length) {
      console.log(`\n[LLM] ${msg.content}`);
      return;
    }

    const callCount = msg.tool_calls.length;
    console.log(`\n[LLM → ${callCount} tool call${callCount > 1 ? "s" : ""} in parallel]`);

    // Execute all tool calls from this round
    for (const call of msg.tool_calls) {
      const fn = call.function.name;
      const args = JSON.parse(call.function.arguments);

      const argsDisplay = Object.keys(args).length ? JSON.stringify(args) : "(no args)";
      console.log(`  call  ${fn} ${argsDisplay}`);

      const handler = handlers[fn];
      if (!handler) throw new Error(`Unknown tool: ${fn}`);

      const result = await handler(args);
      console.log(`  result ${JSON.stringify(result)}`);

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new Error(`Agent did not finish within ${MAX_STEPS} steps`);
}

runAgent().catch((err) => { console.error("Error:", err); process.exit(1); });