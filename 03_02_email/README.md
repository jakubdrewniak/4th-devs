# 03_02_email

Two-phase email agent: triage with labels, then isolated KB-scoped draft sessions.

## Run

```bash
npm run lesson12:email
```

Custom task via CLI args:

```bash
cd 03_02_email && bun src/index.ts "Triage the work inbox only"
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Optional: `AI_PROVIDER`, `MODEL` (default `gpt-4.1`).

## What it does

1. **Triage phase** — reads all unread emails, checks the knowledge base, assigns labels, and marks emails that need replies (no drafts produced)
2. **Draft phase** — for each reply plan, runs an isolated session with a KB scoped to the sender's account and produces a draft reply (completion only, no tool access)

## Notes

Eval suites are available locally: `cd 03_02_email && bun run eval:triage`, `bun run eval:draft-isolation`, `bun run eval:draft-language`, `bun run eval:malicious-email`, or `bun run eval:all`.
