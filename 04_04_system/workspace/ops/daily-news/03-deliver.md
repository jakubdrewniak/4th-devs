---
title: "Phase 3 — Deliver"
agent: rose
depends_on: [02-assemble]
---

# Deliver

Verify the digest and send it. Follow these exact steps — no extras.

## Steps

1. Read `ops/daily-news/{yyyy-mm-dd}/digest.html`.
2. Read `workspace/me/preferences.md` for the recipient email.
3. Verify: file exists, non-empty, no placeholder tokens (`{yyyy-mm-dd}`, `{Topic Name}`), at least one `<h2>` section, and email address found. If any check fails, skip sending and go to step 5 with `delivered: false`.
4. Call `send_email` with the recipient, subject `Daily News — {yyyy-mm-dd}`, and the HTML body.
5. Write `ops/daily-news/{yyyy-mm-dd}/status.md`:

```markdown
---
title: "Delivery Status — {yyyy-mm-dd}"
date: {yyyy-mm-dd}
---

- delivered: true/false
- recipient: {email}
- timestamp: {ISO timestamp}
- issues: none / {description}
```

Do NOT: browse the workspace tree, search for files, use dryRun, or read any files beyond the two listed above.
