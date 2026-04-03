import { connect, listTools, close } from "./src/mcp.js";
import { registerMcpTools } from "./src/tools/registry.js";
import { loadAgent } from "./src/loader.js";
import { chat } from "./src/agent.js";
import { logQuestion, logAnswer, logError, initLogs } from "./src/logger.js";

import { rmSync } from "node:fs";
import { join } from "node:path";

const today = new Date().toISOString().slice(0, 10);
const outputDir = join(import.meta.dirname, "workspace/ops/daily-news", today);
rmSync(outputDir, { recursive: true, force: true });
initLogs();

console.log("\x1b[33m⚠  Make sure FIRECRAWL_API_KEY is set in mcp.json (web server env)\x1b[0m\n");

const prompt = `Run the daily-news workflow for ${today}.

Steps:
1. Read workspace/ops/daily-news/_info.md to understand the workflow, sources, and phases.
2. Read each phase file (01-research.md, 02-assemble.md, 03-deliver.md) to learn the agent assignments.
3. Execute phases strictly sequentially: delegate phase 1, wait for its result, then delegate phase 2, wait for its result, then delegate phase 3. NEVER delegate multiple phases in the same turn — each phase depends on the previous one's output files existing.
4. After all phases complete, summarize what was produced.`;

let mcpClients;

try {
  mcpClients = await connect();
  const mcpTools = await listTools(mcpClients);
  registerMcpTools(mcpTools, mcpClients);

  const alice = await loadAgent("alice");

  logQuestion(prompt);
  const { text } = await chat([{ role: "user", content: prompt }], alice);
  logAnswer(text, alice.name);
} catch (error) {
  logError(error.message);
  process.exit(1);
} finally {
  if (mcpClients) await close(mcpClients);
}
