# 03_05_awareness

Awareness agent with temporal context, memory recall, and scout delegation via MCP.

## Run

```bash
npm run lesson15:awareness
```

Type your prompt in the CLI. Type `exit` to stop.

Scripted demo with visible under-the-hood logs (scout decisions, MCP calls, refresh reasons):

```bash
cd 03_05_awareness && bun run demo
```

To keep demo-seeded files after finishing: `DEMO_PERSIST=1 bun run demo`.

## Required setup

1. Copy `.env.example` to `.env` and fill in any needed values.
2. Set one API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

## What it does

1. Injects current date/time context each turn for dynamic temporal reasoning
2. Reads important-date awareness (birthdays, social dates) from persistent profile files
3. Delegates context exploration to a `look_around` scout sub-agent that reads profile/environment/memory signals through MCP file access
4. Stores awareness snapshots persistently with automatic refresh heuristics (bootstrap, date-sensitive, weather, periodic)

## Notes

Knowledge is read from `workspace/` files (profile, environment, memory) and is not hardcoded. The scout refreshes context selectively — not every turn. The demo runs with debug-level logs and a short refresh cooldown to show the mechanics.
