---
name: product-compare
description: Research products into per-product notes under a topic folder, then run a merge script to assemble an overview note. Use when the user asks for structured product research/comparison.
argument-hint: <topic> | <product-a> | <product-b> | [product-c]
allowed-tools: web_search, code_mode, terminal
runtime-script: scripts/merge-overview.js
---

Use this skill when the user asks for structured product research with a final overview.

## Goal

Produce a topic research workspace with this strict flow:

1. Research each product into its own markdown file.
2. Execute the merge script to generate a topic overview file.

Maximum products: **3**.

If the user gives more than 3 products, ask them to reduce the scope.

## Required Workflow

1. Parse arguments with deterministic rules:
   - Preferred form: `<topic> | <product-a> | <product-b> | [product-c]`
   - If topic is omitted and only products are present, derive topic as joined product slugs:
     - `notion-airtable-clickup`
   - products must be `2-3`
2. Use topic folder:
   - `vault/research/<topic>/`
   - do not create placeholder files (`.keep.md`)
   - writing first product file should create missing directories automatically
3. For each product, run web research and write:
   - `vault/research/<topic>/<product-slug>.md`
4. Use `web_search` to gather evidence for each product:
   - official product page/docs
   - official pricing page (if available)
   - at least one independent source per product
   - target at least **3 source URLs** per product note whenever available
5. Write each product file using the required structure below.
6. Run `code_mode` using the runtime script:
   - `script_path: "vault/system/skills/product-compare/scripts/merge-overview.js"`
   - `input: { "topic": "<topic>" }`
7. Verify output file:
   - `vault/research/<topic>/overview.md`
8. Confirm what was created.

## Required Product File Structure

Each product file (`vault/research/<topic>/<product-slug>.md`) MUST contain:

1. `# <Product Name>`
2. `## Positioning`
3. `## Pricing`
4. `## Key Features`
5. `## Integrations`
6. `## Strengths`
7. `## Risks`
8. `## Best Fit`
9. `## Sources` (bullet list of URLs; include at least one real URL)

Use this normalized schema in the content:

   - positioning
   - key features (3-6)
   - pricing model
   - deployment model
   - integrations/ecosystem
   - strengths
   - risks/tradeoffs
   - best fit

## Missing Information Rule (required)

If information is not found, do NOT skip the section.
Write one explicit line in that section:

`Not found in reviewed sources as of <YYYY-MM-DD>.`

If sources conflict, write:

`Conflicting information across sources; verification required.`

### Deterministic tool usage for this skill

- Use `terminal` for folder/file checks and content writes.
- In `code_mode`, do not attempt web/network retrieval.
- Use `code_mode` only for deterministic merge of existing product notes into overview.
- Do not create or rely on placeholder files like `.keep.md`.

## Output Paths

- Product files:
  - `vault/research/<topic>/<product-slug>.md`
- Merged overview:
  - `vault/research/<topic>/overview.md`

## Code Mode Guidance

Use this exact `code_mode` call shape:

```ts
{
  "script_path": "vault/system/skills/product-compare/scripts/merge-overview.js",
  "input": {
    "topic": "ai-workspaces"
  }
}
```

## Quality Rules

- Keep claims tied to sources.
- Do not fabricate pricing numbers.
- Prefer neutral language over hype.
- If evidence is weak/conflicting, state uncertainty explicitly in the product file.
- Missing information must be explicitly marked ("Not found..." rule above).
