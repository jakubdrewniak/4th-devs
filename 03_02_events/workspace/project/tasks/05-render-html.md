---
id: t5-render-html
title: Render HTML version using project template
project: opus46-vs-gpt53-codex-note
owner: editor
goal_id: opus46-vs-gpt53-codex-note
plan_version: 1
required_capabilities:
  - html-render
status: done
priority: high
depends_on:
  - t4-editorial-quality-gate
output_path: deliverables/report.html
created_by: system
attempt: 0
max_attempts: 3
claimed_by: planner
claimed_at: '2026-03-22T14:35:37.122Z'
run_id: 'hb-a4def3bc:r8'
blocked_by: []
completion_note: >-
  Rendered `report/final-report.md` to `deliverables/report.html` using the
  project template.


  Verification (spot-check in `deliverables/report.html`):

  - Headings render correctly (e.g., `1) Executive takeaway` through `6)
  Evidence quality classification`) and **Sources** renders as a numbered list
  (`<ol>` with linked items).

  - Citations are rendered as clickable links (e.g., `<a
  href="https://www.anthropic.com/news/claude-opus-4-6">Anthropic launch
  post</a>`).

  - No raw URLs appear as plain text i...
created_at: '2026-03-22T14:31:23.937Z'
updated_at: '2026-03-22T14:35:54.621Z'
completed_at: '2026-03-22T14:35:54.621Z'
---
Use the render_html tool to render report/final-report.md into deliverables/report.html using the project template.

Input: report/final-report.md
Output: deliverables/report.html

After rendering, verify:
- Headings and numbered Sources render correctly.
- All citations are clickable markdown links.
- No raw URLs appear in the body text (links are fine).

## Success Criteria
- deliverables/report.html exists
- HTML contains the six required sections and a numbered Sources section
- Spot-check confirms citations are rendered as clickable links and no raw URLs appear as plain text in the report body
