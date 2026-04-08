# 05_03_ax — Email classifier with Ax

Classifies developer inbox emails with labels using [Ax](https://github.com/ax-llm/ax) (DSPy for TypeScript). Demonstrates signatures, few-shot examples, and BootstrapFewShot optimization.

## Setup

```bash
cd 05_03_ax
bun install
```

Requires `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) in the root `.env` file.

## Usage

### Classify emails

```bash
bun run start
```

Runs the classifier on 10 demo emails and prints labels, priority, reply need, and summary for each. If `demos.json` exists (produced by the optimizer), it loads optimized demos automatically. Otherwise falls back to hand-picked examples.

### Optimize with BootstrapFewShot

```bash
bun run optimize
```

Runs the optimizer against labeled training data (`src/eval-data.ts`), collects successful traces, saves the best demos to `demos.json`, then validates on a held-out set. Subsequent `bun run start` runs will pick up the optimized demos.

Delete `demos.json` to revert to the manual fallback examples.

## Project structure

```
src/
  config.ts      — bridges root config.js → Ax AI instance
  emails.ts      — 10 sample developer inbox emails + label definitions
  examples.ts    — hand-picked few-shot fallback examples
  classify.ts    — Ax signature, classifier factory, demo loading
  eval-data.ts   — labeled training + validation sets for the optimizer
  metric.ts      — scoring function (label overlap, priority, reply match)
  optimize.ts    — BootstrapFewShot runner, saves demos.json
  index.ts       — main entry, classifies all emails
  logger.ts      — all console output formatting
demos.json       — (generated) optimized demos from the optimizer
```

## How it works

1. **Signature** — declares I/O shape: `emailFrom, emailSubject, emailBody → labels[], priority, needsReply, summary`. Ax auto-generates the prompt from this.
2. **Few-shot examples** — either hand-picked (`examples.ts`) or optimizer-selected (`demos.json`). Injected into the prompt as demo pairs.
3. **BootstrapFewShot** — runs the classifier on training examples, scores each with a metric function, and collects the successful traces as demos. No prompt rewriting needed — the optimizer finds which real outputs work best as in-context examples.

## Labels

`urgent` · `client` · `internal` · `newsletter` · `billing` · `github` · `security` · `spam` · `automated` · `needs-reply`
