import { connect, listTools, close } from "./src/mcp.js";
import { registerMcpTools } from "./src/tools/registry.js";
import { loadAgent } from "./src/loader.js";
import { chat } from "./src/agent.js";
import { logQuestion, logAnswer, logError, initLogs } from "./src/logger.js";

const query = process.argv.slice(2).join(" ") || "Read workspace/index.md and describe the knowledge base structure.";

initLogs();

console.log("\x1b[33m⚠  Make sure FIRECRAWL_API_KEY is set in mcp.json (web server env)\x1b[0m\n");

let mcpClients;

try {
  mcpClients = await connect();
  const mcpTools = await listTools(mcpClients);
  registerMcpTools(mcpTools, mcpClients);

  const alice = await loadAgent("alice");

  logQuestion(query);
  const { text } = await chat([{ role: "user", content: query }], alice);
  logAnswer(text, alice.name);
} catch (error) {
  logError(error.message);
  process.exit(1);
} finally {
  if (mcpClients) await close(mcpClients);
}
