---
title: "Phase 1 — Research"
agent: ellie
depends_on: []
---

# Research

Search for news and write per-topic notes. Follow these exact steps — no extras.

## Steps

1. Run `web__search` with queries `"{topic} news {yyyy-mm-dd}"` for each topic in `_info.md`. Use `limit: 5`, do NOT scrape (`scrapeResults: false`). Let results save to default output dir.
2. Read the first 50 lines of each search result file to get headlines and URLs.
3. For each topic with results, write a note to `ops/daily-news/{yyyy-mm-dd}/{topic}.md` using the format below.
4. If a topic has no results, skip it.

Do NOT: browse the workspace tree, read templates, scrape full articles, or read source notes. The search snippets are enough.

## Output format

```markdown
---
title: "{Topic} — {yyyy-mm-dd}"
date: {yyyy-mm-dd}
tags: [daily-news, {topic}]
---

# {Topic}

- **{Headline}** — {1-2 sentence summary}. [source]({url})
- ...
```

Target 3-5 items per topic. Use only real URLs from search results.
