---
id: t3-draft-report
title: >-
  Write the decision-grade comparison note (900–1300 words) with citations and
  required structure
project: opus46-vs-gpt53-codex-note
owner: writer
goal_id: opus46-vs-gpt53-codex-note
plan_version: 1
required_capabilities:
  - writing
  - synthesis
status: done
priority: critical
depends_on:
  - t1-evidence-collection
  - t2-normalized-matrix
output_path: report/draft-report.md
created_by: system
attempt: 0
max_attempts: 3
claimed_by: writer
claimed_at: '2026-03-22T14:33:50.293Z'
run_id: 'hb-a4def3bc:r6'
blocked_by: []
completion_note: >-
  Wrote the required draft report to `report/draft-report.md` with the mandated
  6 sections in order plus a numbered **Sources** section.


  Key points implemented:

  - Used `research/comparison-matrix.md` as the backbone for the normalized axes
  table.

  - Used `research/evidence.json` to drive Sections 3 and 6 (and to label the
  lone Anthropic benchmark as *vendor-stated, not independently verified* and
  *non-comparable* cross-vendor).

  - Added inline markdown-link citations for each factual claim (no bare...
created_at: '2026-03-22T14:31:23.935Z'
updated_at: '2026-03-22T14:34:35.093Z'
completed_at: '2026-03-22T14:34:35.093Z'
---
Write report/draft-report.md (target 900–1300 words) following the required final structure:
1. Executive takeaway
2. Side-by-side comparison (normalized axes)
3. Independent validation and contradictions
4. Developer implications ("best fit when...")
5. Caveats, unknowns, and non-comparable metrics
6. Evidence quality classification

Rules:
- Every factual claim must be cited with a short markdown link: ([Title](url)) or ([Source N](url)) consistent with research/sources.md. Do not use raw URLs.
- Clearly attribute which vendor made which claim; do not mix sources.
- For any vendor claim lacking independent corroboration, label it explicitly as "vendor-stated, not independently verified".
- Do not infer superiority from non-comparable metrics; add explicit caveats.
- Include a numbered "Sources" section at the end listing all sources used (titles + short markdown links).

Use research/comparison-matrix.md as the backbone for section 2 and to ensure normalized axes. Use research/evidence.json to support sections 3 and 6.

This draft will be passed to the editor for a citation integrity and caveat quality gate.

## Success Criteria
- report/draft-report.md exists and is between 900 and 1300 words excluding the Sources section
- All factual claims in the draft have an inline markdown link citation (no bare URLs)
- Draft includes all 6 required sections in the specified order and a numbered Sources section at the end
