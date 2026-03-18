/**
 * Graph RAG Agent
 *
 * Indexes workspace text files into Neo4j (full-text + vector + entity graph),
 * then runs an interactive agent that searches via hybrid retrieval and graph exploration.
 */

import { createDriver, verifyConnection } from "./src/graph/driver.js";
import { ensureSchema } from "./src/graph/schema.js";
import { indexWorkspace } from "./src/graph/indexer.js";
import { createTools } from "./src/agent/tools.js";
import { createReadline, runRepl } from "./src/repl.js";
import { onShutdown } from "./src/helpers/shutdown.js";
import { logStats } from "./src/helpers/stats.js";
import log from "./src/helpers/logger.js";

const main = async () => {
  log.box("Graph RAG Agent\nCommands: 'exit' | 'clear' | 'reindex' | 'reindex --force'");

  // 1. Neo4j connection
  log.start("Connecting to Neo4j...");
  const driver = createDriver({
    uri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    username: process.env.NEO4J_USERNAME ?? "neo4j",
    password: process.env.NEO4J_PASSWORD ?? "password",
  });
  await verifyConnection(driver);
  log.success("Neo4j connected");

  // 2. Schema (constraints + indexes)
  log.start("Ensuring graph schema...");
  await ensureSchema(driver);

  // 3. Index workspace
  log.start("Indexing workspace...");
  await indexWorkspace(driver, "workspace");
  log.success("Indexing complete");

  // 4. Agent tools
  const tools = createTools(driver);

  // 5. REPL
  const rl = createReadline();

  const shutdown = onShutdown(async () => {
    logStats();
    rl?.close();
    await driver.close();
  });

  await runRepl({ tools, rl, driver });
  await shutdown();
};

main().catch((err) => {
  log.error("Startup error", err.message);
  process.exit(1);
});
