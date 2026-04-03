---
title: "Daily News"
description: "Multi-agent workflow: research sources, assemble HTML digest, deliver via email"
trigger: cron
schedule: "0 7 * * *"
prompt: "Run the daily-news workflow for today."
---

# Daily News

Three-phase workflow producing a daily email digest from followed sources.

## Sources

Each link points to a knowledge base note describing the source (URL, focus, credibility).

### AI
- [[World/Sources/hacker-news-ai]]

### Dev
- [[World/Sources/hacker-news-dev]]

### Startups
- [[World/Sources/techcrunch]]

## Topics

- `ai` — models, agents, tooling, research
- `dev` — programming languages, frameworks, infrastructure, open source
- `startups` — funding rounds, product launches, acquisitions

## Phases

| # | File | Agent | Action |
|---|------|-------|--------|
| 1 | [[Ops/Daily-News/01-research]] | Ellie | Scan sources, write per-topic notes |
| 2 | [[Ops/Daily-News/02-assemble]] | Tony | Merge topic notes into HTML digest |
| 3 | [[Ops/Daily-News/03-deliver]] | Rose | Verify and send the digest email |

## Output structure

```
ops/daily-news/
  _info.md
  01-research.md
  02-assemble.md
  03-deliver.md
  {yyyy-mm-dd}/
    ai.md
    startups.md
    dev.md
    digest.html
```
