# 03_02_code

Code execution agent with a Deno sandbox and MCP file tools.

## Run

```bash
npm run lesson12:code
```

Custom task via CLI args:

```bash
cd 03_02_code && bun src/index.ts "Summarize all markdown files in the workspace"
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Install [Deno](https://deno.land/#installation) (the sandbox executes LLM-generated code in an isolated Deno process).
4. Optional: `AI_PROVIDER` (`openai` | `openrouter`), `MODEL` (default `gpt-5.2`), `PERMISSION_LEVEL`.

## What it does

1. Connects to an MCP file server for workspace read/write
2. Uses a Deno subprocess sandbox (`execute_code`) with configurable permission levels (`safe`, `standard`, `network`, `full`)
3. An HTTP bridge exposes host-side MCP tools to the sandboxed code at runtime
4. Default task: generate a styled PDF cost report from raw data found in the workspace

## Notes

Generate sample cost data with `cd 03_02_code && bun run generate:data` (creates synthetic data in `workspace/data/`).
