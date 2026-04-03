---
title: "Internal Linking Pass"
description: "Suggest natural internal links using semantic matches from the sitemap, without overlinking or changing tone."
modes: [at_once]
contextFiles:
  - reference/internal-linking-sitemap.md
---

Review the document for internal-linking opportunities.

Goal:
- Turn the draft into a naturally linked article using only URLs from the sitemap context.

Linking checklist:
- Link only when the paragraph meaning closely matches the target page title and description.
- Match by concept and reader intent, not just exact keyword overlap.
- Treat synonyms, paraphrases, implied topics, and task-stage language as valid matches when the destination page clearly fits.
- Use the page title and description together to infer what the target page is really about.
- Prefer anchor text that already exists in the document when it reads naturally.
- If the best match is only implied, you may do a minimal local rewrite to create a better anchor, as long as the sentence keeps the same meaning and tone.
- Keep anchor text specific, short, and readable.
- Preserve the original tone and sentence flow after inserting the link.
- Choose the strongest matches first and skip weak or forced ones.
- Avoid linking headings, code, blockquotes used as quotes, or text already inside markdown links.
- Avoid generic anchors like "here", "this", "read more", or full-sentence links.
- Do not link the same URL repeatedly unless the document is long and the repeat is clearly justified.
- Avoid overlinking. For a short article, 2-4 good links are better than many mediocre ones.
- If more than one URL could fit, choose the page whose title and description best match the local context.

Suggestions:
- Use `suggestion` comments for link insertions.
- Prefer wrapping an existing phrase with markdown link syntax, for example `[anchor text](/target-url)`.
- When needed, replace a short source phrase with a slightly better anchor that matches the same idea, then insert the markdown link.
- Good semantic matches can connect related expressions, for example:
  - "messy docs hub" -> knowledge base structure
  - "keeping writing consistent" -> tone of voice guide
  - "new users moving from setup to success" -> customer onboarding checklist
- Do not invent URLs. Use only the sitemap entries provided in the prompt context.
- If there is no strong internal-link opportunity in a block, add nothing.
