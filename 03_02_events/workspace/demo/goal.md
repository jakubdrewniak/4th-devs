---
id: opus46-vs-gpt53-codex-note
objective: Write a decision-grade comparison note about Claude Opus 4.6 vs GPT-5.3-Codex, anchored in official pages and strengthened with selective independent evidence.
must_have:
  - A concise side-by-side comparison of key claims using normalized axes (capabilities, benchmarks, long-context or agentic features, and product/API updates when stated).
  - Independent corroboration or contrast for major vendor claims, and explicit "not independently verified" labeling where corroboration is missing.
  - A practical "what this means for developers" section with "best fit when..." guidance and caveats about non-comparable metrics.
  - An evidence quality section that tags major conclusions as vendor-stated, independently-supported, or mixed.
  - Final markdown note (target 900-1300 words) at report/final-report.md. Every factual claim must be cited using short markdown links — e.g. ([Anthropic docs](url)) — never raw URLs. Collect all sources in a numbered "Sources" section at the end of the report.
  - HTML version of the final report at deliverables/report.html, rendered using the project template (render_html tool).
forbidden:
  - Hype language, fanboy framing, or unsupported superiority claims
  - Presenting a single benchmark result without naming the source and methodology
  - Mixing up which claim comes from which source
  - Inferring superiority from non-comparable metrics without an explicit caveat
step_budget_rounds: 7
max_total_tasks: 6
max_new_tasks_per_replan: 2
replan_budget: 1
approval_required_for:
  - scope_change
---

## Research strategy

1. **Start with the official pages** — scrape the two primary URLs below for first-party claims.
2. **Build normalized comparison axes** before drafting conclusions (same dimensions for both models).
3. **Run selective web research** for independent benchmarks, developer analyses, and expert commentary that validate, contradict, or add nuance to major claims.
4. **Scrape additional pages only when they materially improve decision quality** (not for redundant coverage).

Always attribute every claim to its source. If a claim appears only in the vendor's own page and no independent source corroborates it, mark it as *"vendor-stated, not independently verified"*.
If direct apples-to-apples comparison is impossible for a metric, state that explicitly instead of inferring.

Stop collection when:
- All must_have sections have enough cited evidence to draft confidently.
- Additional pages are mostly repeating already captured claims.
- New sources do not change the decision implications.

## Required final structure

1. Executive takeaway
2. Side-by-side comparison (normalized axes)
3. Independent validation and contradictions
4. Developer implications ("best fit when...")
5. Caveats, unknowns, and non-comparable metrics
6. Evidence quality classification

## Primary source URLs (scrape these first)

- https://www.anthropic.com/news/claude-opus-4-6
- https://openai.com/index/introducing-gpt-5-3-codex/

## Suggested web search queries (non-exhaustive, agents may add more)

- "Claude Opus 4.6 benchmarks 2026"
- "GPT-5.3-Codex benchmarks 2026"
- "Claude Opus 4.6 vs GPT-5.3 comparison"
- "Claude Opus 4.6 developer review"
- "GPT-5.3-Codex developer review"
