# 02_04_ops

Multi-agent daily ops generator with task delegation.

## Run

```bash
npm run lesson9:ops
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

## What it does

1. Loads agent templates from `workspace/agents/*.agent.md` (orchestrator, mail, calendar, tasks, notes)
2. The orchestrator reads the workflow from `workspace/workflows/daily-ops.md`
3. Delegates data-gathering to specialist agents (mail, calendar, tasks, notes)
4. Synthesizes results against goals and history
5. Writes a daily ops summary to `workspace/output/YYYY-MM-DD.md`

## Notes

Agent definitions live in markdown frontmatter (model, tools, system prompt). The orchestrator delegates via a `delegate` tool — each sub-agent runs in its own conversation loop with a depth limit of 3.
