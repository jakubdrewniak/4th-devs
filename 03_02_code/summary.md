# 03_02_code — Code Execution Agent: How It Works

## Overview

This is an **autonomous AI agent** that solves tasks by writing and executing TypeScript code inside a sandboxed Deno subprocess. The agent has access to the local filesystem (via MCP) and can generate deliverables like PDFs.

```
User Task
   │
   ▼
┌──────────────┐    tool calls    ┌─────────────────────────────────┐
│  LLM Agent   │ ───────────────► │  Tools                          │
│  (OpenAI)    │ ◄─────────────── │  • fs_read / fs_write  (MCP)    │
└──────────────┘    results       │  • execute_code  (Deno sandbox) │
                                  └─────────────────────────────────┘
```

---

## Step-by-Step Walkthrough

### Step 1 — Entry Point: `src/index.ts`

`src/index.ts` is the main orchestrator. It:

1. Asks the user to confirm before consuming LLM tokens (or skips with `--yes`).
2. Reads `PERMISSION_LEVEL` from env (`safe` | `standard` | `network` | `full`).
3. Takes the task from CLI args or falls back to the default (generate a cost report PDF).
4. Bootstraps all subsystems in order:
   - `ensureSandbox()` — verifies Deno is installed and pre-caches `npm:pdfkit`
   - `createMcpClient('files')` — connects to the MCP file server (stdio subprocess)
   - `createMcpTools(client)` — converts MCP tools into agent-compatible `ToolDefinition` objects
   - `startBridge(mcpTools)` — starts the HTTP bridge server
   - `generatePrelude(port, mcpTools)` — generates the JS bridge code injected into every sandbox script
5. Runs the agent and prints the final result.

```
index.ts
  ├── ensureSandbox()      → checks Deno, caches pdfkit
  ├── createMcpClient()    → spawns MCP file server
  ├── createMcpTools()     → wraps MCP tools as ToolDefinitions
  ├── startBridge()        → HTTP server on random port
  ├── generatePrelude()    → JS snippet with tool stubs
  └── runAgent()           → LLM loop
```

See: [src/index.ts](src/index.ts)

---

### Step 2 — MCP Client: `src/mcp.ts`

The Model Context Protocol (MCP) client connects to the **files MCP server** defined in `mcp.json`:

```json
{
  "mcpServers": {
    "files": {
      "command": "bun",
      "args": ["run", "../mcp/files-mcp/src/index.ts"],
      "env": { "FS_ROOT": "workspace" }
    }
  }
}
```

The MCP server runs as a **child process** communicating over stdio. It exposes tools like `fs_read`, `fs_write`, etc., scoped to the `workspace/` directory.

```
Host process (Bun)
  │  stdio (stdin/stdout)
  ▼
MCP Server (also Bun)
  └── exposes: fs_read, fs_write, fs_list, ...
               all paths relative to workspace/
```

Key functions:
- [`createMcpClient()`](src/mcp.ts#L52) — spawns the server and connects via `StdioClientTransport`
- [`listMcpTools()`](src/mcp.ts#L87) — fetches available tool definitions
- [`callMcpTool()`](src/mcp.ts#L96) — invokes a named tool and extracts text content from the response

---

### Step 3 — Tool Registration: `src/tools.ts`

Two kinds of tools are created:

**MCP tools** ([`createMcpTools()`](src/tools.ts#L6)):
- Iterates MCP tool list and wraps each as a `ToolDefinition` with a handler that calls `callMcpTool()`.

**Code execution tool** ([`createCodeTool()`](src/tools.ts#L21)):
- Single tool: `execute_code`
- Accepts TypeScript code as a string
- Delegates to `executeCode()` in the sandbox module
- Displays the code to stdout before running it
- Returns stdout on success, or error details on failure

```
tools = {
  fs_read:       wraps MCP fs_read
  fs_write:      wraps MCP fs_write
  ...            (all MCP tools)
  execute_code:  runs TypeScript in Deno sandbox
}
```

---

### Step 4 — Agent Loop: `src/agent.ts`

A classic **ReAct-style** loop using the OpenAI Chat Completions API:

```
messages = [system_prompt, user_task]

LOOP (max 25 turns):
  1. Call LLM with messages + tools list
  2. If no tool_calls → return final response
  3. For each tool_call:
     a. Parse arguments
     b. Call tool.handler(args)
     c. Append tool result to messages
  4. Continue loop
```

Key details:
- [`runAgent()`](src/agent.ts#L25) drives the loop
- [`buildSystemPrompt()`](src/prompt.ts#L3) sets the agent's role, permissions, and Deno API reference
- Model defaults to `gpt-5.2`, overridable via `MODEL` env var
- Max 25 turns to prevent infinite loops
- Tool errors are caught and returned as messages — the agent can self-correct

---

### Step 5 — Deno Sandbox: `src/sandbox.ts`

The most interesting part. When `execute_code` is called:

1. **Writes** the code to a temp file (prepended with the bridge prelude)
2. **Spawns** `deno run` with scoped permission flags
3. **Captures** stdout/stderr
4. **Cleans up** the temp file
5. Returns `{ stdout, stderr, exitCode, timedOut }`

**Permission levels** control what Deno flags are passed:

| Level      | Read/Write | Network             |
|------------|-----------|---------------------|
| `safe`     | ✗         | bridge only         |
| `standard` | workspace | bridge only         |
| `network`  | workspace | unrestricted        |
| `full`     | all       | all (`--allow-all`) |

See: [`buildPermissionFlags()`](src/sandbox.ts#L87)

---

### Step 6 — HTTP Bridge: `src/sandbox.ts`

**The key insight**: sandboxed Deno code can't call Node/Bun functions directly, but it *can* make HTTP requests. The bridge solves this:

```
Sandbox (Deno process)               Host (Bun process)
  │                                      │
  │  POST http://127.0.0.1:{port}/fs_read│
  ├─────────────────────────────────────►│
  │                                      ├── calls MCP tool fs_read
  │  { result }                          │
  │◄─────────────────────────────────────┤
```

- [`startBridge()`](src/sandbox.ts#L158) — starts a `Bun.serve` HTTP server on a random port, routing `POST /{toolName}` to `tool.handler()`
- [`generatePrelude()`](src/sandbox.ts#L186) — generates a JS snippet injected at the top of every sandbox script:

```typescript
// Auto-generated prelude example:
const tools = {
  async fs_read(input) {
    const res = await fetch("http://127.0.0.1:PORT/fs_read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {})
    });
    return res.json();
  },
  // ... other tools
};
```

So when the LLM writes `await tools.fs_read({ path: "data.json" })` in its code, it transparently calls the MCP server on the host.

---

## Full Data Flow Diagram

```
User runs: bun src/index.ts "Create a PDF report"
                │
                ▼
         ┌─────────────┐
         │  index.ts   │  orchestrates startup
         └──────┬──────┘
                │ spawns
    ┌───────────┼───────────────────┐
    ▼           ▼                   ▼
 MCP Server  HTTP Bridge         Deno (cached)
 (stdio)     (Bun.serve)         pdfkit cached
    │            │
    └─────┬──────┘
          ▼
   ┌─────────────┐
   │  agent.ts   │  ◄── system prompt (prompt.ts)
   │  LLM Loop   │
   └──────┬──────┘
          │  turn 1: LLM calls fs_read("knowledge/")
          ▼
   ┌─────────────┐
   │  tools.ts   │  routes call to MCP
   └──────┬──────┘
          │  turn 2: LLM calls execute_code("...")
          ▼
   ┌──────────────┐
   │  sandbox.ts  │
   │  Deno run    │  executes code + bridge prelude
   │  ┌────────┐  │
   │  │ tools  │──┼──► HTTP Bridge ──► MCP ──► workspace/
   │  └────────┘  │
   └──────────────┘
          │
          ▼
   workspace/deliverables/2026-cost-report.pdf
```

---

## Key Concepts Summary

| Concept | What it does | Where |
|---|---|---|
| MCP (Model Context Protocol) | Standardized tool protocol for file access | `mcp.ts`, `mcp.json` |
| Deno Sandbox | Isolated TypeScript runtime with permission control | `sandbox.ts` |
| HTTP Bridge | Lets sandboxed code call host-side tools | `sandbox.ts` `startBridge()` |
| Prelude injection | Provides `tools` object inside sandbox | `sandbox.ts` `generatePrelude()` |
| ReAct agent loop | LLM decides actions, executes tools, self-corrects | `agent.ts` |
| Permission levels | Controls sandbox access (safe → full) | `types.ts`, `sandbox.ts` |
