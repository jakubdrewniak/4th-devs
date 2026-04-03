// ─── Imports ──────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env from project root ──────────────────────────────────────────────
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

if (existsSync(ROOT_ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ROOT_ENV_FILE);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const AI_DEVS_KEY = process.env.AI_DEVS_KEY?.trim() ?? "";

if (!AI_DEVS_KEY) {
  console.error("[config] Missing AI_DEVS_KEY");
  process.exit(1);
}

const HUB = "https://hub.ag3nts.org";
const TASK = "windpower";

// ─── Types ────────────────────────────────────────────────────────────────────
interface HubResponse {
  code: number;
  message?: string;
  msg?: string;
  note?: string;
  [key: string]: unknown;
}

interface GetResultResponse extends HubResponse {
  sourceFunction: string;
}

interface ForecastEntry {
  timestamp: string;
  windMs: number;
  precipitationMm: number;
  temperatureC: number;
}

interface ConfigPoint {
  startDate: string;  // "2026-04-02"
  startHour: string;  // "18:00:00"
  windMs: number;
  pitchAngle: number;
  turbineMode: "production" | "idle";
  unlockCode?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function callApi(answer: Record<string, unknown>): Promise<HubResponse> {
  const res = await fetch(`${HUB}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: AI_DEVS_KEY, task: TASK, answer }),
  });
  const data = (await res.json()) as HubResponse;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls getResult until all expected sourceFunctions are collected.
// Returns a map: sourceFunction -> response data
async function pollAllResults(
  expected: string[],
  intervalMs = 500,
  maxAttempts = 60
): Promise<Map<string, HubResponse>> {
  const collected = new Map<string, HubResponse>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (collected.size === expected.length) break;

    const result = (await callApi({ action: "getResult" })) as GetResultResponse;

    if (result.sourceFunction) {
      if (expected.includes(result.sourceFunction) && !collected.has(result.sourceFunction)) {
        console.log(`[poll] Received result for: ${result.sourceFunction}`);
        collected.set(result.sourceFunction, result);
      } else {
        console.log(`[poll] Unexpected/duplicate sourceFunction: ${result.sourceFunction} — ignoring`);
      }
    } else {
      // Queue empty — wait before retrying
      await sleep(intervalMs);
    }
  }

  if (collected.size < expected.length) {
    const missing = expected.filter((e) => !collected.has(e));
    throw new Error(`[poll] Timed out waiting for: ${missing.join(", ")}`);
  }

  return collected;
}

// Polls getResult exactly `count` times filtering by sourceFunction.
// Returns list of raw responses in arrival order.
async function pollNResultsBySource(
  sourceFunction: string,
  count: number,
  intervalMs = 500,
  maxAttempts = 120
): Promise<HubResponse[]> {
  const collected: HubResponse[] = [];

  for (let attempt = 0; attempt < maxAttempts && collected.length < count; attempt++) {
    const result = (await callApi({ action: "getResult" })) as GetResultResponse;

    if (result.sourceFunction === sourceFunction) {
      console.log(`[poll:${sourceFunction}] Got ${collected.length + 1}/${count}`);
      collected.push(result);
    } else if (result.sourceFunction) {
      console.log(`[poll:${sourceFunction}] Skipping unexpected sourceFunction: ${result.sourceFunction}`);
    } else {
      await sleep(intervalMs);
    }
  }

  if (collected.length < count) {
    throw new Error(`[poll:${sourceFunction}] Timed out. Got ${collected.length}/${count}`);
  }

  return collected;
}

// Splits "2026-04-02 18:00:00" into { startDate: "2026-04-02", startHour: "18:00:00" }
function splitTimestamp(timestamp: string): { startDate: string; startHour: string } {
  const [startDate, startHour] = timestamp.split(" ");
  return { startDate, startHour };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("\n━━━ STEP 1: Init — help & start ━━━");

  // 1a. Wywołaj help — poznaj API
  console.log("\n[step 1a] Calling 'help' action...");
  const helpResponse = await callApi({ action: "help" });
  console.log("[step 1a] Help response:", JSON.stringify(helpResponse, null, 2));

  // 1b. Wywołaj start — otwórz okno serwisowe
  console.log("\n[step 1b] Calling 'start' action...");
  const startResponse = await callApi({ action: "start" });
  console.log("[step 1b] Start response:", JSON.stringify(startResponse, null, 2));

  const START_SUCCESS_CODE = 60;
  if (startResponse.code !== START_SUCCESS_CODE) {
    throw new Error(`[step 1b] start failed with code: ${startResponse.code}`);
  }
  console.log("[step 1b] Service window opened successfully. Session timeout:", startResponse.sessionTimeout, "s");

  // ─── STEP 2: Fetch data ──────────────────────────────────────────────────────
  console.log("\n━━━ STEP 2: Fetch data ━━━");

  // 2a. Documentation — synchronous, returned directly
  console.log("\n[step 2a] Fetching documentation...");
  const docResponse = await callApi({ action: "get", param: "documentation" });
  console.log("[step 2a] Documentation:", JSON.stringify(docResponse, null, 2));

  // 2b. Enqueue async data fetches in parallel
  console.log("\n[step 2b] Enqueueing async fetches: weather, turbinecheck, powerplantcheck...");
  const [weatherEnqueue, turbineEnqueue, powerplantEnqueue] = await Promise.all([
    callApi({ action: "get", param: "weather" }),
    callApi({ action: "get", param: "turbinecheck" }),
    callApi({ action: "get", param: "powerplantcheck" }),
  ]);
  console.log("[step 2b] weather enqueue:", JSON.stringify(weatherEnqueue));
  console.log("[step 2b] turbinecheck enqueue:", JSON.stringify(turbineEnqueue));
  console.log("[step 2b] powerplantcheck enqueue:", JSON.stringify(powerplantEnqueue));

  // 2c. Poll getResult until all 3 responses are collected
  console.log("\n[step 2c] Polling getResult for all 3 responses...");
  const results = await pollAllResults(["weather", "turbinecheck", "powerplantcheck"]);

  console.log("\n[step 2c] All results received:");
  for (const [key, val] of results.entries()) {
    console.log(`\n--- ${key} ---`);
    console.log(JSON.stringify(val, null, 2));
  }

  // ─── STEP 3: Analyze data + generate unlock codes ────────────────────────────
  console.log("\n━━━ STEP 3: Analyze data + generate unlock codes ━━━");

  const weatherData = results.get("weather")!;
  const doc = docResponse as { safety?: { cutoffWindMs?: number }; [key: string]: unknown };
  const cutoffWindMs: number = (doc.safety as { cutoffWindMs: number })?.cutoffWindMs ?? 14;

  const forecast = weatherData.forecast as ForecastEntry[];
  console.log(`\n[step 3a] Total forecast entries: ${forecast.length}`);
  console.log(`[step 3a] Cutoff wind speed: ${cutoffWindMs} m/s`);

  // Find all storm entries (wind > cutoff)
  const stormEntries = forecast.filter((e) => e.windMs > cutoffWindMs);
  console.log(`\n[step 3a] Storm entries (wind > ${cutoffWindMs} m/s):`);
  stormEntries.forEach((e) => console.log(`  ${e.timestamp} → ${e.windMs} m/s`));

  // Find best production entry: highest windMs in range [4, cutoff]
  const productionCandidates = forecast.filter((e) => e.windMs >= 4 && e.windMs <= cutoffWindMs);
  const bestProduction = productionCandidates.reduce<ForecastEntry | null>(
    (best, e) => (!best || e.windMs > best.windMs ? e : best),
    null
  );
  if (!bestProduction) throw new Error("[step 3a] No valid production slot found in forecast");
  console.log(`\n[step 3a] Best production slot: ${bestProduction.timestamp} → ${bestProduction.windMs} m/s`);

  // Build config points
  const configPoints: ConfigPoint[] = [
    // Storm protection entries
    ...stormEntries.map((e) => ({
      ...splitTimestamp(e.timestamp),
      windMs: e.windMs,
      pitchAngle: 90,
      turbineMode: "idle" as const,
    })),
    // Production entry
    {
      ...splitTimestamp(bestProduction.timestamp),
      windMs: bestProduction.windMs,
      pitchAngle: 0,
      turbineMode: "production" as const,
    },
  ];

  console.log(`\n[step 3b] Config points to submit (${configPoints.length} total):`);
  configPoints.forEach((p) =>
    console.log(`  ${p.startDate} ${p.startHour} | wind=${p.windMs} pitch=${p.pitchAngle} mode=${p.turbineMode}`)
  );

  // 3c. Generate unlock codes in parallel for all config points
  console.log(`\n[step 3c] Enqueuing unlockCodeGenerator for all ${configPoints.length} config points...`);
  await Promise.all(
    configPoints.map((p) =>
      callApi({
        action: "unlockCodeGenerator",
        startDate: p.startDate,
        startHour: p.startHour,
        windMs: p.windMs,
        pitchAngle: p.pitchAngle,
      })
    )
  );
  console.log("[step 3c] All unlockCodeGenerator requests enqueued.");

  // 3d. Poll for all unlock codes
  console.log(`\n[step 3d] Polling for ${configPoints.length} unlock codes...`);
  const unlockResults = await pollNResultsBySource("unlockCodeGenerator", configPoints.length);

  console.log("\n[step 3d] Raw unlock code responses:");
  unlockResults.forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r)));

  // ─── STEP 4: Match codes + send config + turbinecheck + done ─────────────────
  console.log("\n━━━ STEP 4: Match unlock codes + send config ━━━");

  // 4a. Build lookup map: "startDate startHour" → unlockCode
  // signedParams echo back what was signed, so we match by date+hour (unique per point)
  const unlockMap = new Map<string, string>();
  for (const r of unlockResults) {
    const signed = r.signedParams as { startDate: string; startHour: string };
    const key = `${signed.startDate} ${signed.startHour}`;
    unlockMap.set(key, r.unlockCode as string);
  }
  console.log("\n[step 4a] Unlock code map:");
  unlockMap.forEach((code, key) => console.log(`  ${key} → ${code}`));

  // 4b. Assign unlock codes to config points
  for (const p of configPoints) {
    const key = `${p.startDate} ${p.startHour}`;
    p.unlockCode = unlockMap.get(key);
    if (!p.unlockCode) throw new Error(`[step 4b] No unlock code found for ${key}`);
  }
  console.log("\n[step 4b] Config points with unlock codes:");
  configPoints.forEach((p) =>
    console.log(`  ${p.startDate} ${p.startHour} | pitch=${p.pitchAngle} mode=${p.turbineMode} → ${p.unlockCode}`)
  );

  // 4c. Build batch config object and send
  // Key format: "2026-04-02 18:00:00"
  const configs: Record<string, { pitchAngle: number; turbineMode: string; unlockCode: string }> = {};
  for (const p of configPoints) {
    const key = `${p.startDate} ${p.startHour}`;
    configs[key] = {
      pitchAngle: p.pitchAngle,
      turbineMode: p.turbineMode,
      unlockCode: p.unlockCode!,
    };
  }

  console.log("\n[step 4c] Sending batch config...");
  console.log("[step 4c] Payload:", JSON.stringify(configs, null, 2));
  const configResponse = await callApi({ action: "config", configs });
  console.log("[step 4c] Config response:", JSON.stringify(configResponse, null, 2));

  if (configResponse.code !== 0) {
    console.warn("[step 4c] WARNING: config returned non-zero code:", configResponse.code);
  } else {
    console.log("[step 4c] Config saved successfully.");
  }

  // ─── STEP 5: turbinecheck + done ─────────────────────────────────────────────
  console.log("\n━━━ STEP 5: turbinecheck + done ━━━");

  // 5a. Request turbinecheck (async) — required before done
  console.log("\n[step 5a] Requesting turbinecheck...");
  const turbinecheckEnqueue = await callApi({ action: "get", param: "turbinecheck" });
  console.log("[step 5a] Turbinecheck enqueued:", JSON.stringify(turbinecheckEnqueue));

  // 5b. Poll for turbinecheck result
  console.log("\n[step 5b] Polling for turbinecheck result...");
  const [turbinecheckResult] = await pollNResultsBySource("turbinecheck", 1);
  console.log("[step 5b] Turbinecheck result:", JSON.stringify(turbinecheckResult, null, 2));

  // 5c. Send done — validate config and get flag
  console.log("\n[step 5c] Sending 'done' action...");
  const doneResponse = await callApi({ action: "done" });
  console.log("[step 5c] Done response:", JSON.stringify(doneResponse, null, 2));

  // Check for flag
  const flagMatch = JSON.stringify(doneResponse).match(/\{FLG:[^}]+\}/);
  if (flagMatch) {
    console.log(`\n[SUCCESS] FLAG FOUND: ${flagMatch[0]}`);
  } else {
    console.warn("\n[WARNING] No flag in done response. Check config validity.");
  }
}

main().catch((err) => {
  console.error("[error]", (err as Error).message);
  process.exit(1);
});
