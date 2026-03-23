# 03_01_evals

Agent server with Langfuse tracing and a synthetic tool-use evaluation suite.

## Run

```bash
npm run lesson11:evals
```

In a **separate terminal**, run the demo client:

```bash
npm run lesson11:evals:demo
```

Run evaluation experiments (standalone, no server needed):

```bash
npm run lesson11:evals:tools        # tool-use eval
npm run lesson11:evals:correctness  # response-correctness eval
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Optional: set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in root `.env` or local `.env` for tracing (degrades gracefully when missing).

## What it does

1. Starts an HTTP server with `POST /api/chat`, `GET /api/sessions`, and `GET /api/health`
2. Runs a multi-turn agent loop (Alice) with `get_current_time` and `sum_numbers` tools via the Responses API
3. Wraps every request in a Langfuse trace with span hierarchy: `chat-request` → `alice` → `generation#N` / `tool#N`
4. Evaluation experiments seed/upsert datasets into Langfuse, run `dataset.runExperiment(...)` with per-case evaluators, and write per-item + run-level scores

## Notes

The server runs on `http://localhost:3010` by default (override with `PORT`). This is the same agent as `03_01_observability` but upgraded to the Responses API with an `experiments/` folder layered on top for programmatic evaluation.
