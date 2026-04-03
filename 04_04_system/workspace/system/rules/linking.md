---
title: "Linking Rules"
description: "How notes should reference each other"
status: evergreen
publish: false
tags: [system, rules]
access.read: [agent]
access.write: [human]
---

# Linking Rules

## Wikilink format

Use `[[path/to/note]]` for internal references. Paths are relative to `workspace/`.

## When to link

- Every mention of a person, tool, project, or concept that has its own note.
- Every note should link back to its parent index.
- Cross-area links are encouraged when the relationship is meaningful.

## When not to link

- Do not link common words that happen to match a note title.
- Do not create circular link chains with no content value.

## External links

- Use full URLs: `[label](https://example.com)`.
- Prefer permanent URLs over shortened ones — agents cannot infer content from opaque slugs.
- If an image is referenced, host it externally and embed as a URL, not a local file path.
