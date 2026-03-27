# 03_05_apps

MCP app server with CLI agent, todo/shopping list UI, and live browser preview.

## Run

```bash
npm run lesson15:apps
```

Then ask in the CLI, for example: `open todo manager`, `manage my shopping list`.

## Required setup

1. Copy `.env.example` to `.env` and fill in any needed values.
2. Optionally set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY` (without a key, the app still works with deterministic routing).

## What it does

1. Runs two servers: a local UI server (opens in browser) and an MCP server exposing an app-enabled tool + UI resource
2. When the agent chooses the `open_list_manager` tool, it opens the browser UI
3. The UI edits and saves markdown files (`todo.md`, `shopping.md`), showing one active list at a time

## Notes

Both markdown files are created automatically if they don't exist. Run `cd 03_05_apps && bun run build:ui` to rebuild the UI bundle from `ui/` sources.
