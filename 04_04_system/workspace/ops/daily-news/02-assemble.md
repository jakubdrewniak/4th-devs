---
title: "Phase 2 — Assemble"
agent: tony
depends_on: [01-research]
---

# Assemble

Merge today's topic notes into a single HTML digest. Follow these exact steps — no extras.

## Steps

1. List the directory `workspace/ops/daily-news/{yyyy-mm-dd}/` using plain list mode (no glob filter, no respectIgnore). From the results, select only `.md` files — ignore `digest.html`, `status.md`, and directories.
2. Read each topic note.
3. Write `ops/daily-news/{yyyy-mm-dd}/digest.html` using the template below, filling in content from the notes.

Do NOT: browse the workspace tree, read templates, read `_info.md`, or use dryRun.

## HTML Template

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="border-bottom: 2px solid #333; padding-bottom: 8px;">Daily News — {yyyy-mm-dd}</h1>

  <!-- repeat for each topic -->
  <h2>{Topic Name}</h2>
  <ul>
    <!-- repeat for each item -->
    <li><strong>{Headline}</strong> — {Summary} <a href="{url}">[source]</a></li>
  </ul>
  <!-- end repeat -->

  <hr>
  <p style="font-size: 12px; color: #888;">Assembled from sources listed in ops/daily-news/_info.md</p>
</body>
</html>
```

## Rules

- Do not invent content. Only use what exists in the topic notes.
- If no topic notes exist, write a minimal digest stating "No news collected today."
- Preserve all source URLs from the research notes.
