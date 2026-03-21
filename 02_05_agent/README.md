# 02_05_agent

Context engineering agent with observational memory (observer/reflector pattern).

## Run

From the **repo root**, first install dependencies, then start the agent server and run the demo:

```bash
npm run lesson10:install
npm run lesson10:agent
```

In a **separate terminal**, run the demo script that sends a multi-phase conversation to the agent:

```bash
npm run lesson10:agent:demo
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

## What it does

1. Starts an HTTP server (`POST /api/chat`) with session-based conversations
2. As conversation grows, an **observer** compresses older messages into structured observations
3. When observations grow too large, a **reflector** distills them further
4. The agent's context window always contains: compressed history (observations) + recent raw messages
5. Memory logs are persisted to `workspace/memory/`

## Notes

The server runs on `http://localhost:3001` by default (override with `PORT` env var). Use `GET /api/sessions` to list sessions and `POST /api/sessions/:id/flush` to force-compress remaining messages.

