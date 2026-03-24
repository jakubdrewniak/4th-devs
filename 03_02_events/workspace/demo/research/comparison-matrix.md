# Normalized comparison axes (for report)

Use these axes consistently across models. If an axis is not supported by evidence, mark **Unknown / not stated in sources** rather than inferring.

## 1) capabilities
**Thesis:** What the model can do in real tasks (coding, reasoning, security analysis, etc.).
**Reader action:** Map feature claims to your own workload types; flag where only vendor evidence exists.

**Include as comparable sub-claims when available:** task domains, qualitative strengths/weaknesses, known failure modes.

## 2) benchmarks
**Thesis:** Quantitative performance claims (evals, leaderboards), with harness/metric clarity.
**Reader action:** Prefer independently run/replicable benchmarks; tag private evals as not independently verified.

**Include:** benchmark name, split, metric, harness/toolchain, whether result is independently verifiable.

## 3) context_and_memory
**Thesis:** How much information can be provided/retained and how retrieval/memory works.
**Reader action:** Determine feasibility for long-repo, long-doc, or persistent assistant use cases.

**Include:** context window, retrieval mechanisms, explicit memory features, stated limitations.

## 4) agentic_and_tooling
**Thesis:** Ability to act via tools (code execution, IDE integration, agents), and operational boundaries.
**Reader action:** Assess automation potential and required guardrails.

**Include:** tool APIs, agent frameworks, code execution, IDE/plugins, sandboxing, audit logs (if stated).

## 5) product_and_api
**Thesis:** How you access the model and integrate it (endpoints, SDKs, deployment surfaces).
**Reader action:** Identify integration work and compatibility/lock-in risks.

**Include:** API endpoints, SDK support, model naming/versioning, deployment options.

## 6) availability
**Thesis:** Where and for whom the model is available.
**Reader action:** Check whether your org/region/tier can actually use it.

**Include:** regions, tiers, rollout statements, cloud marketplaces.

## 7) pricing_and_limits
**Thesis:** Cost and quota constraints **only when explicitly stated**.
**Reader action:** Budget and capacity planning; if absent, escalate to vendor.

**Include:** per-token pricing, rate limits, quotas. Otherwise: **Unknown / not stated in sources**.

## 8) safety_and_policy
**Thesis:** Documented safety posture, policy constraints, and risk mitigations **only when explicitly stated**.
**Reader action:** Determine whether deployment risk profile matches your governance requirements.

**Include:** system cards, safety evaluations, policy notes; if absent: **Unknown / not stated in sources**.

---

# Side-by-side comparison matrix (traceable claims)

**Legend**
- Evidence tags: **[vendor]**, **[independent]**, **[mixed]**
- Add-on tags: **[not independently verified]**, **[non-comparable]**
- Each cell: claim + citation placeholder `([Source N](URL))`.

> Note: Current evidence coverage is sparse for GPT-5.3-Codex and several axes. Cells are marked Unknown when sources in `research/evidence.json` contain no claim.

| Claim category (normalized) | Claude Opus 4.6 | GPT-5.3-Codex |
|---|---|---|
| **Benchmarks → Cybersecurity investigations (private eval / blind ranking)** | “Across 40 cybersecurity investigations, Claude Opus 4.6 produced the best results 38 of 40 times in a blind ranking against Claude 4.5 models.” ([Source 1](https://www.anthropic.com/news/claude-opus-4-6)) **[vendor] [not independently verified] [non-comparable]** | **Unknown / not stated in sources** (no corresponding evidence item captured) |
| **Capabilities → Cybersecurity investigation performance (qualitative summary)** | Indicates improved outcomes on cybersecurity investigations vs prior Claude 4.5 models, based on internal comparison. ([Source 1](https://www.anthropic.com/news/claude-opus-4-6)) **[vendor] [not independently verified]** | **Unknown / not stated in sources** |
| **Availability → Third-party cloud/marketplace availability** | **Unknown / not stated in sources** (a Snowflake blog source exists in sources list but no extracted claim in evidence) | **Unknown / not stated in sources** |
| **Product & API → Access / endpoints / SDKs** | **Unknown / not stated in sources** | **Unknown / not stated in sources** |
| **Context & memory → Context length / memory features** | **Unknown / not stated in sources** | **Unknown / not stated in sources** |
| **Agentic & tooling → Tools/agents/IDE integration** | **Unknown / not stated in sources** | **Unknown / not stated in sources** |
| **Pricing & limits** | **Unknown / not stated in sources** | **Unknown / not stated in sources** |
| **Safety & policy** | **Unknown / not stated in sources** | **Unknown / not stated in sources** |

---

# Comparison traps (from current evidence)

1) **Snippet-only evidence:** The only captured claim is from a search snippet and not a scraped primary-page excerpt, increasing risk of paraphrase/omission. (Applies to Source 1 claim.)
2) **Private/unclear eval harness:** “40 cybersecurity investigations” and “blind ranking” lack publicly available methodology details in the captured evidence, making results hard to reproduce or compare. **[not independently verified]**
3) **Non-isomorphic comparisons:** Claim compares Opus 4.6 to Claude 4.5 models, not to GPT-5.3-Codex; treating it as cross-vendor would be a category error. **[non-comparable]**

