---
id: t1-evidence-collection
title: >-
  Collect first-party claims + selective independent evidence with traceable
  citations
project: opus46-vs-gpt53-codex-note
owner: researcher
goal_id: opus46-vs-gpt53-codex-note
plan_version: 1
required_capabilities:
  - research
  - evidence
  - web-scrape
  - web-search
status: done
priority: critical
depends_on: []
output_path: research/evidence.json
created_by: system
attempt: 1
max_attempts: 3
claimed_by: researcher
claimed_at: '2026-03-22T14:33:10.439Z'
run_id: 'hb-a4def3bc:r4'
blocked_by: []
human_answer: Proceed with the most evidence-backed and reversible option.
completion_note: >-
  Created the required deliverables, but **collection is blocked** by a tooling
  failure that prevents meeting the task’s “12+ first‑party atomic claims per
  model with exact quotes” requirement.


  ## What I completed

  - Wrote `research/evidence.json` (valid JSON array) with **1 vendor claim**
  (Anthropic) captured from a search-result snippet, explicitly marked as **not
  independently verified** and **needs replacement with exact page quote** once
  scraping works.

  - Wrote `research/sources.md` with **8 ...
created_at: '2026-03-22T14:31:23.934Z'
updated_at: '2026-03-22T14:33:25.268Z'
completed_at: '2026-03-22T14:33:25.268Z'
---
Create a structured evidence pack at research/evidence.json.

Steps:
1) Scrape the two primary URLs and extract all decision-relevant claims (capabilities, benchmarks, context/agentic features, product/API updates, limitations). Keep each claim atomic.
   - Anthropic: https://www.anthropic.com/news/claude-opus-4-6
   - OpenAI: https://openai.com/index/introducing-gpt-5-3-codex/
2) Run selective web searches for independent corroboration/contrast for the major vendor claims. Prioritize: third-party benchmarks with methodology, reputable engineering blogs, academic/benchmark org pages, and tool/vendor docs that clarify API/product behavior.
3) For each claim, store:
   - model: "Claude Opus 4.6" | "GPT-5.3-Codex"
   - axis: one of [capabilities, benchmarks, context_and_memory, agentic_and_tooling, product_and_api, safety_and_policy, pricing_and_limits, availability]
   - claim: short text
   - claimType: "vendor" | "independent" | "mixed"
   - verification: "independently_supported" | "vendor_stated_not_independently_verified" | "contradicted_or_contested" | "non_comparable"
   - sourceTitle: page title
   - sourceUrl: canonical URL
   - quote: exact supporting quote/snippet (or benchmark table row text)
   - methodologyNotes: for benchmarks (dataset, eval harness, date, who ran it)
   - notes: any caveats (e.g., different prompts, private evals, non-public harness)
4) Ensure at least:
   - 12+ atomic claims per model from first-party pages (if available)
   - 6+ independent sources total (if available) that materially affect decision quality
5) Save a companion short-link map at research/sources.md: numbered list of sources with titles and URLs; this will be used to create short markdown links in the report.

Output format requirements:
- evidence.json must be valid JSON array of claim objects.
- sources.md must be a numbered list with one source per line: "1. Title — URL".

Stop collection when must-have sections are supportable and new sources become redundant.

## Success Criteria
- research/evidence.json exists and is valid JSON containing an array of claim objects with required fields (model, axis, claim, claimType, verification, sourceTitle, sourceUrl, quote)
- research/sources.md exists with a numbered list of sources (>= 8 entries unless the web lacks material; if fewer, include a note in evidence.json notes fields explaining why)
- At least 2 benchmark-related claim objects include methodologyNotes describing dataset/eval harness and who ran it
