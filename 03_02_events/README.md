# 03_02_events

Multi-agent event architecture with heartbeat loop, observer/reflector memory, and human-in-the-loop.

## Run

```bash
npm run lesson12:events
```

This runs the full demo (report-v2 workflow, 10 rounds). A Polish-language confirmation prompt will appear because this example is request-heavy. To preview results without running, see `workspace/demo/`.

Custom flags via local scripts:

```bash
cd 03_02_events
bun run demo --workflow report-v2 --rounds 12 --delay-ms 500
bun run start   # bare index.ts (no reset, no summary)
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Set `GEMINI_API_KEY` — used by the `create_image` tool.
4. Optional: `OPENAI_MODEL` (default `gpt-5.2`), `WEB_SEARCH_MODEL` (default `gpt-5.2`), `HEARTBEAT_DELAY_MS` (default `750`).

## What it does

1. Reads a goal contract from `workspace/goal.md` and scans agent templates for capabilities
2. Calls an LLM planner to generate a validated task plan, then materializes it as markdown task files
3. Runs a heartbeat loop that claims tasks, dispatches them to specialist agents (researcher, planner, writer, editor, designer), and detects completion
4. Each agent session uses observer/reflector memory compaction for long-running threads
5. Human-in-the-loop pauses via `request_human` tool and persisted wait states
6. Produces deliverables in `workspace/project/` — reports, evidence, event logs, memory snapshots

## Notes

Pre-generated demo results are available in `workspace/demo/` (final report, HTML deliverable, tasks, plan, events, memory logs). The demo resets `workspace/project/` on each run by default (`--reset=true`).
