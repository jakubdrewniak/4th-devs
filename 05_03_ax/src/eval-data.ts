import type { Label } from './emails.js';

export interface LabeledEmail {
  emailFrom: string;
  emailSubject: string;
  emailBody: string;
  labels: Label[];
  priority: 'high' | 'medium' | 'low';
  needsReply: boolean;
}

export const trainingSet: LabeledEmail[] = [
  {
    emailFrom: 'notifications@github.com',
    emailSubject: '[acme/api-gateway] PR #347: Fix race condition in connection pool',
    emailBody: '@mkowalski requested your review on acme/api-gateway#347\n\nChanges:\n- Replaced mutex with RWLock in pool.rs\n- Added regression test for concurrent checkout\n\nFiles changed: 3  Additions: 87  Deletions: 24',
    labels: ['github', 'automated', 'needs-reply'],
    priority: 'medium',
    needsReply: true,
  },
  {
    emailFrom: 'ci@github.com',
    emailSubject: '[acme/web-app] CI failed on main — build #1892',
    emailBody: 'Build #1892 on branch main failed.\n\nJob: test-integration\nError: ECONNREFUSED 127.0.0.1:5432 — database container did not start in time\n\nAuthor: dependabot[bot]',
    labels: ['github', 'automated'],
    priority: 'high',
    needsReply: false,
  },
  {
    emailFrom: 'newsletter@javascriptweekly.com',
    emailSubject: 'JavaScript Weekly #721: Node 24 LTS, Bun 1.3, and V8 perf deep-dive',
    emailBody: 'JavaScript Weekly — Issue #721\n\n▸ Node.js 24 enters LTS\n▸ Bun 1.3 ships native S3 client\n▸ V8 deep-dive: Maglev JIT\n\nUnsubscribe: https://javascriptweekly.com/unsubscribe',
    labels: ['newsletter', 'automated'],
    priority: 'low',
    needsReply: false,
  },
  {
    emailFrom: 'anna.berg@northstar.io',
    emailSubject: 'API integration — timeline question',
    emailBody: "Hi,\n\nWe're planning to integrate your events API. Questions:\n1. Is the v2 webhooks endpoint stable?\n2. Do you support batch delivery?\n3. Any rate limits?\n\nCould you hop on a 30-min call Thursday?\n\nAnna Berg\nNorthstar Analytics",
    labels: ['client', 'needs-reply'],
    priority: 'medium',
    needsReply: true,
  },
  {
    emailFrom: 'billing@vercel.com',
    emailSubject: 'Your invoice for March 2026 is ready',
    emailBody: 'Your Vercel Pro invoice for March 2026 is available.\n\nAmount: $42.00\nPlan: Pro (2 members)\n\nView invoice: https://vercel.com/account/billing',
    labels: ['billing', 'automated'],
    priority: 'low',
    needsReply: false,
  },
  {
    emailFrom: 'kasia.dev@acme.com',
    emailSubject: 'Quick sync on caching strategy',
    emailBody: "Hey,\n\nBefore sprint planning — I've been looking at Redis vs in-memory cache for the session store.\n\nRedis: shared state, TTL built-in. In-memory: zero latency.\n\nLeaning Redis since we're going multi-pod. Thoughts?\n\nKasia",
    labels: ['internal', 'needs-reply'],
    priority: 'medium',
    needsReply: true,
  },
  {
    emailFrom: 'recruiter@talentforge.io',
    emailSubject: 'Exclusive: Staff Engineer at stealth AI unicorn — $400k TC',
    emailBody: 'Your GitHub profile caught our eye! Staff Engineer role, $380-420k + equity, fully remote. 15 minutes for a quick chat?\n\nJake Miller\nTalentForge Recruiting',
    labels: ['spam'],
    priority: 'low',
    needsReply: false,
  },
  {
    emailFrom: 'security@github.com',
    emailSubject: '[Security Alert] Dependabot found 2 high-severity vulnerabilities in acme/api-gateway',
    emailBody: 'GitHub found 2 high-severity vulnerabilities:\n\n1. CVE-2026-1234 — Prototype pollution in lodash\n2. CVE-2026-5678 — ReDoS in semver\n\nDependabot PRs opened automatically.',
    labels: ['security', 'github', 'automated', 'urgent'],
    priority: 'high',
    needsReply: false,
  },
  {
    emailFrom: 'no-reply@linear.app',
    emailSubject: 'You were assigned: ACME-412 — Implement rate limiter middleware',
    emailBody: 'You were assigned to ACME-412.\n\nPriority: High\nDue: Apr 1, 2026\n\nAdd token-bucket rate limiter to API gateway.',
    labels: ['automated', 'urgent'],
    priority: 'high',
    needsReply: false,
  },
  {
    emailFrom: 'noreply@aws.amazon.com',
    emailSubject: 'AWS Budget Alert: 80% of monthly budget reached',
    emailBody: 'Budget: Monthly Infrastructure\nThreshold: 80% ($4,000 of $5,000)\nCurrent spend: $4,127.43\nForecasted: $5,480.00',
    labels: ['automated', 'billing'],
    priority: 'medium',
    needsReply: false,
  },
];

export const validationSet: LabeledEmail[] = [
  {
    emailFrom: 'notifications@github.com',
    emailSubject: '[acme/core] Issue #201: Memory leak in worker thread pool',
    emailBody: '@you was mentioned: "Can you look at this? Seems related to the pool changes from last week." Memory grows ~50MB/hour under load.',
    labels: ['github', 'automated', 'needs-reply'],
    priority: 'medium',
    needsReply: true,
  },
  {
    emailFrom: 'sales@saasplatform.io',
    emailSubject: 'Your trial expires in 3 days — upgrade now!',
    emailBody: "Hi there,\n\nYour SaasPlatform trial ends March 28. Upgrade to Pro for $29/mo and keep all your data.\n\nDon't miss out!\nThe SaasPlatform Team",
    labels: ['spam', 'automated'],
    priority: 'low',
    needsReply: false,
  },
  {
    emailFrom: 'tomek.brandt@shopflow.de',
    emailSubject: 'Re: Webhook delivery failures — any update?',
    emailBody: "We're still seeing ~3% webhook delivery failures, primarily 503s. Our integration team needs a status update. Is this related to the replication issues?\n\nTomek Brandt\nCTO, ShopFlow",
    labels: ['client', 'needs-reply', 'urgent'],
    priority: 'high',
    needsReply: true,
  },
  {
    emailFrom: 'noreply@sentry.io',
    emailSubject: '[Sentry] ACME-API: RangeError: Maximum call stack size exceeded (142 events)',
    emailBody: 'Issue: RangeError: Maximum call stack size exceeded\nProject: acme-api\nEvents: 142 in last hour\nFirst seen: 10 min ago\nAffects: /api/v2/webhooks endpoint',
    labels: ['automated', 'urgent'],
    priority: 'high',
    needsReply: false,
  },
  {
    emailFrom: 'patryk.wisniewski@acme.com',
    emailSubject: 'Portfolio page — tone of voice direction?',
    emailBody: "Hey,\n\nWorking on the new portfolio page. Should we go:\nA) Professional/corporate\nB) Casual/confident\nC) Minimal — let work speak for itself\n\nLeaning B. Thoughts?\n\nPatryk",
    labels: ['internal', 'needs-reply'],
    priority: 'low',
    needsReply: true,
  },
];
