# Skills + Code Mode Concept (MCP + Daytona)

This note captures a proposed architecture for evolving `04_01_garden` from direct tool-calling toward a skill-driven, code-oriented execution model.

## Why this direction

- Tool calling works well for simple actions, but complex multi-step flows are brittle when each step must be serialized through model/tool/model loops.
- A code-mode approach lets the model write executable orchestration code once, then run it in a sandbox and return distilled output.
- Daytona already exposes primitives (`process.codeRun`, `process.executeCommand`, `fs.*`, sessions) that fit this execution model.

## Proposed Architectural Layers

### 1) Skill Layer (Intent + Policy)

Introduce skill definitions under `vault/system/skills/`:

- `SKILL.md`-style documents with:
  - intent/description
  - trigger phrases
  - allowed capabilities
  - output expectations
  - optional execution mode (`inline` or `code_mode`)

Skill examples:

- `research-topic` (web + note synthesis)
- `garden-edit` (content rewrite with frontmatter constraints)
- `publish-garden` (validation + `git_push`)
- `mcp-investigate` (calls MCP-backed APIs through generated code)

### 2) Capability Layer (Typed Runtime APIs)

Instead of exposing many raw tools directly, provide a small stable API surface to code-mode scripts:

- `vault.read(path)`
- `vault.write(path, content)` (policy-restricted)
- `vault.search(path, pattern)`
- `runtime.execSafe(command)` (strict allowlist)
- `publish.commitAndPush(message)` (delegates to existing `git_push`)
- `web.search(query)` (if desired as proxied helper)

The API should be easier to reason about than raw tool calls and map 1:1 to approved capabilities.

### 3) Code Mode Layer (Execution)

Add a `code_mode` tool:

- Input: TypeScript snippet + optional arguments
- Execution: `sandbox.process.codeRun(...)` in Daytona
- Network: blocked by default where possible
- File access: only through helper API or policy-checked wrappers
- Output contract: JSON envelope (`ok`, `result`, `logs`, `errors`)

This tool becomes the single programmable orchestration primitive for multi-step tasks.

### 4) MCP Integration Layer

For MCP tools:

- Option A (short-term): keep MCP as function tools; expose selected MCP calls through typed helpers.
- Option B (target): auto-generate typed adapters from MCP schemas and inject those adapters into code-mode context.

This preserves MCP interoperability while moving call composition into code.

## Execution Modes

1. **Direct mode** (today)
   - Model calls `text_editor`, `exec`, `git_push`, etc.
2. **Skill-guided direct mode**
   - Skill decides which direct tools to use and in what order.
3. **Skill-guided code mode** (target)
   - Skill triggers code generation + sandbox execution against typed APIs.

## Security Model

- Keep capability boundaries explicit:
  - `text_editor` for deterministic file operations
  - `exec` for minimal diagnostics
  - `git_push` for publication
- For code mode:
  - sandbox network blocked or allowlisted
  - restricted environment variables
  - strict path allowlists
  - execution timeouts and output limits

## Recommended Implementation Path

1. **Phase 1 (done baseline)**
   - deterministic `text_editor`
   - strict `exec` policy
2. **Phase 2 (implemented baseline)**
   - add `vault/system/skills/` + recursive `SKILL.md` loader into template instructions
   - inject skill metadata (`description`, invocation flags, `allowed-tools`) for selection guidance
3. **Phase 3 (implemented baseline)**
   - add `code_mode` tool backed by `process.codeRun`
   - expose typed helper APIs to scripts (`codemode.vault.*`, `codemode.runtime.execSafe`, `codemode.output.set`)
4. **Phase 4**
   - MCP adapter generation for code mode
   - migrate complex workflows to skill + code mode

## Visualization Nodes (for diagrams)

- User
- Agent Loop
- Skill Resolver
- Capability Gate
- Code Mode Executor
- Daytona Sandbox
- Typed Capability API
- MCP Adapters
- Vault Content
- Git Push / CI Deploy

## Diagram Flow (high level)

User request -> Skill Resolver -> (Direct tools OR Code Mode Executor) -> Capability Gate -> Daytona execution -> Vault changes -> Publish path

