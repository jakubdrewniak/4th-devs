import { existsSync, readFileSync } from "node:fs";
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

const HUB = "https://hub.ag3nts.org";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Person {
  name: string;
  surname: string;
  birthYear: number;
}

interface PowerPlant {
  code: string;
  lat: number;
  lon: number;
}

// ─── Haversine distance (km) ─────────────────────────────────────────────────

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

// ─── Load suspects from previous exercise ────────────────────────────────────

function fetchSuspects(): Person[] {
  const answersPath = path.join(ROOT_DIR, "01_01__ex_people", "answers.json");
  const raw = readFileSync(answersPath, "utf-8");
  const people: Array<{ name: string; surname: string; born: number }> = JSON.parse(raw);
  return people.map(p => ({ name: p.name, surname: p.surname, birthYear: p.born }));
}

// ─── Known coordinates for Polish cities ─────────────────────────────────────

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  "Zabrze":                    { lat: 50.3249, lon: 18.7857 },
  "Piotrków Trybunalski":      { lat: 51.4047, lon: 19.6979 },
  "Grudziądz":                 { lat: 53.4850, lon: 18.7534 },
  "Tczew":                     { lat: 53.7774, lon: 18.7780 },
  "Radom":                     { lat: 51.4027, lon: 21.1471 },
  "Chelmno":                   { lat: 53.3486, lon: 18.4254 },
  "Chełmno":                   { lat: 53.3486, lon: 18.4254 },
  "Żarnowiec":                 { lat: 54.5859, lon: 18.1540 },
};

// ─── Fetch power plants ───────────────────────────────────────────────────────

async function fetchPowerPlants(): Promise<PowerPlant[]> {
  const url = `${HUB}/data/${AI_DEVS_KEY}/findhim_locations.json`;
  console.log(`Fetching power plants: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Structure: { power_plants: { CityName: { code, is_active, power }, ... } }
  const plants: PowerPlant[] = [];
  const map: Record<string, any> = data.power_plants ?? data;

  for (const [city, info] of Object.entries(map)) {
    const coords = CITY_COORDS[city];
    if (!coords) {
      console.warn(`No coordinates for city: ${city}`);
      continue;
    }
    plants.push({ code: (info as any).code, lat: coords.lat, lon: coords.lon });
  }

  console.log("Power plants:", JSON.stringify(plants, null, 2));
  return plants;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function getLocations(name: string, surname: string): Promise<{ lat: number; lon: number }[]> {
  const res = await fetch(`${HUB}/api/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, name, surname }),
  });
  const data = await res.json();
  console.log(`Locations for ${name} ${surname}:`, JSON.stringify(data));
  // Normalize response: could be array of coords or wrapped
  if (Array.isArray(data)) return data;
  if (data.locations) return data.locations;
  if (data.answer) return data.answer;
  return [];
}

async function getAccessLevel(name: string, surname: string, birthYear: number): Promise<number> {
  const res = await fetch(`${HUB}/api/accesslevel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, name, surname, birthYear }),
  });
  const data = await res.json();
  console.log(`Access level for ${name} ${surname}:`, JSON.stringify(data));
  if (typeof data === "number") return data;
  if (typeof data.accessLevel === "number") return data.accessLevel;
  if (typeof data.answer === "number") return data.answer;
  return data.accessLevel ?? data.answer ?? data.level ?? 0;
}

async function submitAnswer(answer: {
  name: string;
  surname: string;
  accessLevel: number;
  powerPlant: string;
}): Promise<any> {
  console.log("\nSubmitting answer:", JSON.stringify(answer, null, 2));
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: "findhim", answer }),
  });
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
  return data;
}

// ─── Find closest power plant in code ────────────────────────────────────────

interface Match {
  person: Person;
  powerPlant: PowerPlant;
  distanceKm: number;
}

async function findClosestMatch(suspects: Person[], powerPlants: PowerPlant[]): Promise<Match> {
  let best: Match | null = null;

  await Promise.all(
    suspects.map(async (person) => {
      const locs = await getLocations(person.name, person.surname);
      for (const loc of locs) {
        const lat = (loc as any).latitude ?? (loc as any).lat;
        const lon = (loc as any).longitude ?? (loc as any).lon;
        if (lat == null || lon == null) continue;
        for (const plant of powerPlants) {
          const d = haversine(lat, lon, plant.lat, plant.lon);
          if (!best || d < best.distanceKm) {
            best = { person, powerPlant: plant, distanceKm: d };
          }
        }
      }
    })
  );

  if (!best) throw new Error("No match found");
  return best;
}

// ─── Final steps: access level + submit ──────────────────────────────────────

async function finishAndSubmit(match: Match): Promise<void> {
  const { person, powerPlant, distanceKm } = match;
  console.log(`\nClosest match: ${person.name} ${person.surname} → ${powerPlant.code} (${distanceKm.toFixed(2)} km)`);

  const accessLevel = await getAccessLevel(person.name, person.surname, person.birthYear);
  await submitAnswer({ name: person.name, surname: person.surname, accessLevel, powerPlant: powerPlant.code });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const suspects = fetchSuspects();
  const powerPlants = await fetchPowerPlants();

  console.log(`\nSuspects (${suspects.length}):`, suspects);
  console.log(`\nPower plants (${powerPlants.length}):`, powerPlants);

  const match = await findClosestMatch(suspects, powerPlants);
  await finishAndSubmit(match);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
