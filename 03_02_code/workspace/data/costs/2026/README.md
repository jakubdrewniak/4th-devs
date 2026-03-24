# 2026 Large Cost Dataset

Generated synthetic enterprise spending data for code-execution reporting demos.

## Structure
- Separate folder per department
- 12 months x 2 budget buckets (`run`, `change`) per department
- Rich line-item metadata (`category`, `subcategory`, `vendor`, `approval_tier`, `region`, etc.)

## Scale
- Departments: 10
- JSON files: 240
- Line items: 11508
- Grand total (USD): 68680068.06

This size is intended to be expensive to pass through LLM context directly,
while still practical to aggregate quickly using sandboxed code execution.
