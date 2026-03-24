---
id: t4-editorial-quality-gate
title: >-
  Editorial quality gate: verify citations, attribution, non-comparable caveats,
  and evidence-quality tags
project: opus46-vs-gpt53-codex-note
owner: editor
goal_id: opus46-vs-gpt53-codex-note
plan_version: 1
required_capabilities:
  - editing
  - refinement
status: done
priority: critical
depends_on:
  - t3-draft-report
output_path: report/qa-checklist.json
created_by: system
attempt: 0
max_attempts: 3
claimed_by: editor
claimed_at: '2026-03-22T14:34:35.753Z'
run_id: 'hb-a4def3bc:r7'
blocked_by: []
completion_note: |-
  Created and QA-gated two deliverables:

  - `report/final-report.md`
    - Removed draft markers and any hype/superiority framing not supported by evidence.
    - Enforced short-label citation format everywhere: `([label](url))` (no raw URLs in prose).
    - Ensured the “38 of 40” claim is explicitly labeled vendor-stated, not independently verified, and not cross-vendor comparable.
    - Added/kept explicit non-comparability caveats (cross-vendor + “SWE-bench referenced but no model-specific scores prese...
created_at: '2026-03-22T14:31:23.936Z'
updated_at: '2026-03-22T14:35:36.466Z'
completed_at: '2026-03-22T14:35:36.466Z'
---
Perform an editorial QA pass on report/draft-report.md and produce:
1) report/qa-checklist.json with:
   - citationCoverage: { totalFactualClaimsChecked, missingCitationsCount, examples[] }
   - attributionErrors: array of issues where a claim is attributed to the wrong source/model
   - nonComparableCaveats: { requiredCount, presentCount, missingExamples[] }
   - hypeOrUnsupportedSuperiority: array of flagged phrases/claims to remove
   - benchmarkMethodologyNamed: array of benchmark mentions missing source/methodology
   - evidenceQualitySectionCheck: pass/fail + notes (must tag major conclusions as vendor-stated, independently-supported, or mixed)
2) Apply fixes and produce the final markdown at report/final-report.md.

Constraints to enforce:
- No hype language or unsupported superiority claims.
- No single benchmark result without naming the source and methodology.
- Explicitly label "vendor-stated, not independently verified" where needed.
- Ensure the Sources section is numbered and all links are short markdown links.

The final markdown will be used for HTML rendering in the next task.

## Success Criteria
- report/qa-checklist.json exists and includes all required keys with non-empty values (counts may be zero)
- report/final-report.md exists and resolves all issues flagged as missing citations or attribution errors (missingCitationsCount == 0; attributionErrors length == 0)
- Final report retains required structure and includes an Evidence quality classification section tagging major conclusions
