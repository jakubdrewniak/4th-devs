---
id: t2-normalized-matrix
title: Build normalized comparison axes + side-by-side matrix with traceability
project: opus46-vs-gpt53-codex-note
owner: planner
goal_id: opus46-vs-gpt53-codex-note
plan_version: 1
required_capabilities:
  - planning
  - structuring
  - assembly
status: done
priority: high
depends_on:
  - t1-evidence-collection
output_path: research/comparison-matrix.md
created_by: system
attempt: 0
max_attempts: 3
claimed_by: planner
claimed_at: '2026-03-22T14:33:25.931Z'
run_id: 'hb-a4def3bc:r5'
blocked_by: []
completion_note: >-
  Created `research/comparison-matrix.md` with:


  - **Normalized axis definitions** for the report (capabilities, benchmarks,
  context_and_memory, agentic_and_tooling, product_and_api, availability,
  pricing_and_limits, safety_and_policy).

  - A **side-by-side matrix** using traceable citation placeholders formatted as
  `([Source N](URL))` (currently only Source 1 has extracted evidence; all other
  cells are explicitly marked **Unknown / not stated in sources** rather than
  inferred).

  - **Verification tag...
created_at: '2026-03-22T14:31:23.935Z'
updated_at: '2026-03-22T14:33:49.622Z'
completed_at: '2026-03-22T14:33:49.622Z'
---
Using research/evidence.json, produce research/comparison-matrix.md containing:

1) A normalized axis definition section (the exact axes to be used in the report):
   - capabilities
   - benchmarks
   - context_and_memory (long context, memory, retrieval, etc.)
   - agentic_and_tooling (tools, code execution, agents, IDE integration, etc.)
   - product_and_api (API changes, SDKs, endpoints, deployment options)
   - availability (regions, tiers, rollout)
   - pricing_and_limits (only if stated in sources; otherwise mark unknown)
   - safety_and_policy (only if stated in sources)

2) A side-by-side table where each row is a comparable claim category and each cell contains:
   - the claim text
   - a short citation placeholder in the form: ([Source N](URL)) using the numbering from research/sources.md
   - a verification tag: [vendor], [independent], [mixed], plus [not independently verified] or [non-comparable] where applicable

3) A short list of "comparison traps" discovered from evidence (e.g., different benchmark harnesses, private evals, different toolchains) to be used later in the Caveats section.

This artifact will be used directly by the writer to draft the side-by-side comparison and caveats sections.

## Success Criteria
- research/comparison-matrix.md exists and includes axis definitions plus a side-by-side table covering at least 4 axes
- Every table cell with a factual claim includes a citation placeholder formatted as a markdown link
- Matrix includes explicit tags for at least 5 items marked [not independently verified] or [non-comparable] if applicable based on evidence
