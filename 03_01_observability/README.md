# 03_01_observability

Minimal agent server with Langfuse tracing wired at the adapter boundary.

## Run

```bash
npm run lesson11:observability
```

In a **separate terminal**, run the demo client:

```bash
npm run lesson11:observability:demo
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Optional: set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in root `.env` or local `.env` for tracing (degrades gracefully when missing).

## What it does

1. Starts an HTTP server with `POST /api/chat`, `GET /api/sessions`, and `GET /api/health`
2. Runs a multi-turn agent loop (Alice) with `get_current_time` and `sum_numbers` tools
3. Wraps every request in a Langfuse trace with explicit span hierarchy: `chat-request` → `alice` → `generation#N` / `tool#N`
4. Flushes traces after every request and on shutdown to reduce trace loss

## Notes

The server runs on `http://localhost:3000` by default (override with `PORT`). Tracing is initialized once at startup and skipped when Langfuse credentials are missing. The demo script sends a multi-turn conversation and prints responses.
