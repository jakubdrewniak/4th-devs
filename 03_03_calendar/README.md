# 03_03_calendar

Calendar agent with add-events and notification-webhook phases.

## Run

```bash
npm run lesson13:calendar
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Optional: `AI_PROVIDER`, `MODEL` (default `gpt-5.2`).

## What it does

1. **Add events phase** — processes a series of user scheduling requests, each with a time context and location, using calendar tools to create events
2. **Notification phase** — processes upcoming-event webhook payloads and sends exactly one notification per event using notification tools

## Notes

Both phases run sequentially in a single process. Each phase uses its own agent session with dedicated tools.
