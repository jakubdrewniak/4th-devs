import { connect, listTools, close } from "./src/mcp.js";
import { registerMcpTools } from "./src/tools/registry.js";
import { loadAgent } from "./src/loader.js";
import { chat } from "./src/agent.js";
import { logQuestion, logAnswer, logError, initLogs } from "./src/logger.js";

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE = join(import.meta.dirname, "workspace");

const cleanup = () => {
  const paths = [
    "craft/ideas/wikilink-graph-cli.md",
    "craft/knowledge/AI/retrieval-augmented-generation.md",
    "craft/lab/wikilink-graph-parser.md",
    "craft/shared/building-ai-agents-from-scratch.md",
    "world/people/marcin-kowalski.md",
    "world/sources/andrej-karpathy.md",
    "world/tools/claude-code.md",
  ];

  for (const rel of paths) {
    const full = join(WORKSPACE, rel);
    if (existsSync(full)) rmSync(full);
  }
};

const queries = [
  `I just had an idea: what if we built a CLI tool that watches the workspace folder and auto-generates a graph of wikilinks between notes? Could be useful for visualization.`,
  `Add a knowledge note about RAG (Retrieval-Augmented Generation). It combines vector search with LLM generation to ground answers in external documents. Key concepts: embedding, chunking, retrieval, reranking. Good source: https://arxiv.org/abs/2005.11401`,
  `Add my friend Marcin Kowalski. We went to university together, now he works at Google as a senior engineer. We chat on Signal, he lives in Zurich. Big fan of Rust and distributed systems.`,
  `I want to try building a small Bun script that uses the marked library to parse all markdown files in a folder and output a JSON graph of wikilinks. Call it "wikilink-graph-parser". Just a quick experiment to see if the parsing is reliable enough.`,
  `Add Andrej Karpathy YouTube channel as a source. He covers deep learning, neural networks, and building AI from scratch. URL: https://www.youtube.com/@AndrejKarpathy — I watch it weekly, one of the best AI educators out there.`,
  `Add a shared note. Title: "Building AI Agents from Scratch". Description: "Workshop teaching JavaScript developers how to build LLM agents with tool-calling patterns". Format: workshop. Audience: mid-level JS devs new to LLM tool-calling. Core message: agents are just loops with tools, no magic. Distribution: eduweb.pl.`,
  `Add a note about Claude Code — it's an AI coding tool by Anthropic that runs in the terminal. I use it daily for programming. URL: https://docs.anthropic.com/en/docs/claude-code`,
];

const selected = process.argv[2]
  ? [queries[parseInt(process.argv[2], 10) - 1]].filter(Boolean)
  : queries;

if (selected.length === 0) {
  console.error("Invalid query number. Use 1-7 or omit for all.");
  process.exit(1);
}

cleanup();
initLogs();

console.log("\x1b[33m⚠  Make sure FIRECRAWL_API_KEY is set in mcp.json (web server env)\x1b[0m\n");

let mcpClients;

try {
  mcpClients = await connect();
  const mcpTools = await listTools(mcpClients);
  registerMcpTools(mcpTools, mcpClients);

  const alice = await loadAgent("alice");
  let conversation = [];

  for (const query of selected) {
    logQuestion(query);
    conversation.push({ role: "user", content: query });
    const result = await chat(conversation, alice);
    conversation = [...result.conversation, { role: "assistant", content: result.text }];
    logAnswer(result.text, alice.name);
    console.log("");
  }
} catch (error) {
  logError(error.message);
  process.exit(1);
} finally {
  if (mcpClients) await close(mcpClients);
}
