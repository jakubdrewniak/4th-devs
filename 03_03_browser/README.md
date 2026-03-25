# 03_03_browser

Browser automation agent with Playwright, session persistence, and MCP file tools.

## Run

**Step 1** — Login to Goodreads (one-time, saves session cookies):

```bash
npm run lesson13:browser:login
```

A browser window opens. Go to [goodreads.com](https://www.goodreads.com), log into your account, then come back to the terminal and press Enter.

**Step 2** — Start the chat agent:

```bash
npm run lesson13:browser
```

Try asking: `List all books by Jim Collins` or `Find top-rated books about strategy`.

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. A [Goodreads](https://www.goodreads.com) account for authenticated access.
4. Optional: `AI_PROVIDER`, `MODEL` (default `gpt-5.2`).

## What it does

1. Launches a Playwright browser (headless by default) with persisted session cookies
2. Connects to an MCP file server for workspace file access
3. Runs an agentic loop with browser tools (navigate, screenshot, click, type, extract) and file tools
4. Maintains conversation history via `previous_response_id` chaining

## Notes

If you skip the login step, the agent starts without authentication and some Goodreads features may be limited. Re-run `npm run lesson13:browser:login` any time to refresh the session.
