# 02_05_sandbox

MCP sandbox agent with tool discovery and QuickJS code execution.

## Run

```bash
npm run lesson10:sandbox
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

## What it does

1. Connects to an MCP todo server (`servers/todo.ts`) over stdio
2. Discovers available tools dynamically from the MCP server
3. Loads an agent template from `workspace/agents/sandbox.agent.md`
4. Runs a task (passed as CLI args or a default demo) through an agentic loop
5. Tool calls are executed in a sandboxed QuickJS environment

## Notes

Pass a custom task as CLI arguments: `bun src/index.ts "your task here"`. The default demo creates a shopping list, marks an item complete, and shows remaining items.

...