export interface Email {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export const LABELS = [
  'urgent',
  'client',
  'internal',
  'newsletter',
  'billing',
  'github',
  'security',
  'spam',
  'automated',
  'needs-reply',
] as const;

export type Label = (typeof LABELS)[number];

export const emails: Email[] = [
  {
    id: 'e001',
    from: 'notifications@github.com',
    subject: '[acme/api-gateway] PR #347: Fix race condition in connection pool',
    body: `@mkowalski requested your review on acme/api-gateway#347

Changes:
- Replaced mutex with RWLock in pool.rs
- Added regression test for concurrent checkout
- Benchmark shows 12% throughput improvement under contention

Files changed: 3  Additions: 87  Deletions: 24

View PR: https://github.com/acme/api-gateway/pull/347`,
  },
  {
    id: 'e002',
    from: 'ci@github.com',
    subject: '[acme/web-app] CI failed on main — build #1892',
    body: `Build #1892 on branch main failed.

Job: test-integration
Step: Run integration tests
Error: ECONNREFUSED 127.0.0.1:5432 — database container did not start in time

Commit: abc1234 "update deps and fix lint warnings"
Author: dependabot[bot]

View logs: https://github.com/acme/web-app/actions/runs/1892`,
  },
  {
    id: 'e003',
    from: 'newsletter@javascriptweekly.com',
    subject: 'JavaScript Weekly #721: Node 24 LTS, Bun 1.3, and V8 perf deep-dive',
    body: `JavaScript Weekly — Issue #721

▸ Node.js 24 enters LTS with require(esm) enabled by default
▸ Bun 1.3 ships native S3 client and cross-compile support
▸ V8 deep-dive: how Maglev JIT reduces cold-start latency by 30%
▸ TC39: Iterator helpers and Temporal reach Stage 4
▸ Tutorial: building a real-time dashboard with Hono + htmx

Read online: https://javascriptweekly.com/issues/721
Unsubscribe: https://javascriptweekly.com/unsubscribe`,
  },
  {
    id: 'e004',
    from: 'anna.berg@northstar.io',
    subject: 'API integration — timeline question',
    body: `Hi,

We're planning to integrate your events API into our analytics pipeline. Our PM is asking for a realistic go-live date.

Questions:
1. Is the v2 webhooks endpoint stable or still in beta?
2. Do you support batch delivery (we process ~50k events/hour)?
3. Any rate limits we should plan around?

We'd like to kick off next sprint if possible. Could you hop on a 30-min call Thursday?

Thanks,
Anna Berg
Senior Engineer, Northstar Analytics`,
  },
  {
    id: 'e005',
    from: 'billing@vercel.com',
    subject: 'Your invoice for March 2026 is ready',
    body: `Hi,

Your Vercel Pro invoice for March 2026 is available.

Amount: $42.00
Plan: Pro (2 members)
Bandwidth: 312 GB used of unlimited
Serverless executions: 1.2M

View invoice: https://vercel.com/account/billing
Payment method: Visa ending in 8821

Thanks,
Vercel Billing`,
  },
  {
    id: 'e006',
    from: 'kasia.dev@acme.com',
    subject: 'Quick sync on caching strategy',
    body: `Hey,

Before sprint planning tomorrow — I've been looking at the Redis vs in-memory cache question for the session store.

Redis pros: shared state across pods, TTL built-in, persistence option.
Downside: extra infra cost (~$45/mo for managed), adds network hop (~2ms p99).

In-memory (Map + LRU): zero latency, dead simple.
Downside: no sharing between pods, lost on restart.

I'm leaning Redis since we're about to go multi-pod. Thoughts?

Kasia`,
  },
  {
    id: 'e007',
    from: 'recruiter@talentforge.io',
    subject: 'Exclusive: Staff Engineer at stealth AI unicorn — $400k TC',
    body: `Hi there,

Your GitHub profile caught our eye! We have an incredible opportunity:

Role: Staff Engineer (Platform)
Company: Stealth AI startup (Series C, $2B valuation)
TC: $380-420k + equity
Location: Fully remote

The founders are ex-Google DeepMind and they're building the future of AI agents.

15 minutes for a quick chat? I promise it'll be worth your time!

Best,
Jake Miller
TalentForge Recruiting`,
  },
  {
    id: 'e008',
    from: 'security@github.com',
    subject: '[Security Alert] Dependabot found 2 high-severity vulnerabilities in acme/api-gateway',
    body: `GitHub found 2 high-severity vulnerabilities in your repository acme/api-gateway.

1. CVE-2026-1234 — Prototype pollution in lodash < 4.17.22
   Severity: High | CVSS: 8.1
   Fix: upgrade lodash to >= 4.17.22

2. CVE-2026-5678 — ReDoS in semver < 7.5.5
   Severity: High | CVSS: 7.5
   Fix: upgrade semver to >= 7.5.5

Dependabot PRs have been opened automatically.

Review alerts: https://github.com/acme/api-gateway/security/dependabot`,
  },
  {
    id: 'e009',
    from: 'no-reply@linear.app',
    subject: 'You were assigned: ACME-412 — Implement rate limiter middleware',
    body: `You were assigned to ACME-412.

Title: Implement rate limiter middleware
Priority: High
Sprint: Sprint 22 (Mar 24 – Apr 4)
Due: Apr 1, 2026

Description:
Add token-bucket rate limiter to API gateway. Must support per-tenant limits from config, return 429 with Retry-After header, and emit metrics to Prometheus.

Acceptance criteria:
- Configurable per-tenant limits
- 429 response with correct headers
- Grafana dashboard panel
- Load test passing at 10k req/s

View issue: https://linear.app/acme/issue/ACME-412`,
  },
  {
    id: 'e010',
    from: 'noreply@aws.amazon.com',
    subject: 'AWS Budget Alert: 80% of monthly budget reached',
    body: `AWS Budgets Notification

Account: acme-production (123456789012)
Budget: Monthly Infrastructure
Threshold: 80% ($4,000.00 of $5,000.00)
Current spend: $4,127.43
Forecasted end-of-month: $5,480.00

Top cost drivers:
- EC2: $1,890 (46%)
- RDS: $1,120 (27%)
- Data Transfer: $580 (14%)

Review your costs: https://console.aws.amazon.com/billing/home`,
  },
];
