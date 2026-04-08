# 05_02_ui

A focused example of a **high-quality Svelte 5 chat UI** backed by a **simple Bun-powered streaming server**.

The goal is to prove the front-end architecture for:

- very long chat histories
- streamed assistant text
- tool call / tool result cards
- artifact previews
- event-sourced rendering

## What is included

- `server/index.ts`
  - minimal HTTP server
  - JSON snapshot endpoint for hydration
  - SSE chat endpoint for streaming the newest assistant turn
  - fake tool side effects that write files into `.data/`
- `server/mock.ts`
  - deterministic mock scenarios for sales, email, artifact, and research turns
  - history seeding so the UI can test long threads
- `src/lib/runtime/materialize.ts`
  - pure event-to-block materializer
- `src/lib/components/*`
  - production-minded Svelte components for streamed text, tool interactions, thinking, artifacts, and errors
- `src/lib/stores/chat-store.ts`
  - client-side event log management and SSE consumption

## Run

```bash
bun install
bun run dev
```

This starts:

- the Bun API server on `http://localhost:3300`
- the Vite dev server on `http://localhost:5173`

## Build

```bash
bun run build
bun run start
```

## Notes

- The server is intentionally **mock-first** so the UI can be tuned without paying provider latency or token cost.
- The conversation list is rendered through a lightweight virtualization strategy plus resize measurement.
- Historical messages are hydrated first; only the newest assistant turn streams live.
