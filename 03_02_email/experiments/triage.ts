import { LangfuseClient, type Evaluator } from '@langfuse/client';
import {
  loadDataset, ensureDataset, syncDatasetItems,
  createAvgScoreEvaluator, toCaseInput,
  type DatasetItemSeed,
} from './lib/index.js';
import { runTriagePhase } from '../src/phases/triage.js';
import { drafts, emails, labels } from '../src/data/mock-inbox.js';
import { resetMockInboxState } from './lib/mock-inbox-state.js';

const DATASET_NAME = '03_02_email/triage';
const MODEL = process.env.MODEL ?? 'gpt-4.1';

interface TriageCase {
  id: string;
  task: string;
  requiredReplyEmailIds: string[];
  minReplyPlans: number;
  minNewlyLabeledUnread: number;
  expectNoDrafts: boolean;
}

const rawCases = loadDataset<TriageCase>('triage');

const toSeeds = (cases: TriageCase[]): DatasetItemSeed[] =>
  cases.map((c) => ({
    id: `triage_${c.id}`,
    input: { id: c.id, task: c.task },
    expectedOutput: {
      requiredReplyEmailIds: c.requiredReplyEmailIds,
      minReplyPlans: c.minReplyPlans,
      minNewlyLabeledUnread: c.minNewlyLabeledUnread,
      expectNoDrafts: c.expectNoDrafts,
    },
  }));

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const toNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const userLabelIndex = (): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const label of labels) {
    if (label.type !== 'user') continue;
    const bucket = index.get(label.account) ?? new Set<string>();
    bucket.add(label.id);
    index.set(label.account, bucket);
  }
  return index;
};

const countUserLabels = (
  account: string,
  labelIds: string[],
  index: Map<string, Set<string>>,
): number => {
  const allowed = index.get(account);
  if (!allowed) return 0;
  return labelIds.filter((labelId) => allowed.has(labelId)).length;
};

const triageEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const ci = toCaseInput(input);
  const expected = (typeof expectedOutput === 'object' && expectedOutput != null
    ? expectedOutput
    : {}) as {
    requiredReplyEmailIds?: unknown;
    minReplyPlans?: unknown;
    minNewlyLabeledUnread?: unknown;
    expectNoDrafts?: unknown;
  };
  const data = (typeof output === 'object' && output != null ? output : {}) as {
    replyEmailIds?: unknown;
    replyPlanCount?: unknown;
    newlyLabeledUnreadEmailIds?: unknown;
    draftsCreated?: unknown;
    accountMismatchCount?: unknown;
  };

  const requiredReplyEmailIds = toStringArray(expected.requiredReplyEmailIds);
  const minReplyPlans = toNumber(expected.minReplyPlans);
  const minNewlyLabeledUnread = Math.max(0, toNumber(expected.minNewlyLabeledUnread));
  const expectNoDrafts = expected.expectNoDrafts !== false;

  const replyEmailIds = toStringArray(data.replyEmailIds);
  const replySet = new Set(replyEmailIds);
  const requiredHits = requiredReplyEmailIds.filter((emailId) => replySet.has(emailId));

  const replyPlanCount = Math.max(0, toNumber(data.replyPlanCount));
  const newlyLabeledUnreadEmailIds = toStringArray(data.newlyLabeledUnreadEmailIds);
  const draftsCreated = Math.max(0, toNumber(data.draftsCreated));
  const accountMismatchCount = Math.max(0, toNumber(data.accountMismatchCount));

  const requiredCoverage = requiredReplyEmailIds.length > 0
    ? requiredHits.length / requiredReplyEmailIds.length
    : 1;
  const labelProgress = minNewlyLabeledUnread > 0
    ? Math.min(1, newlyLabeledUnreadEmailIds.length / minNewlyLabeledUnread)
    : 1;

  return [
    {
      name: 'triage_required_reply_coverage',
      value: requiredCoverage,
      comment: `[${ci.id}] Required marked: ${requiredHits.length}/${requiredReplyEmailIds.length}`,
    },
    {
      name: 'triage_min_reply_plans',
      value: replyPlanCount >= minReplyPlans ? 1 : 0,
      comment: `[${ci.id}] reply plans=${replyPlanCount}, expected>=${minReplyPlans}`,
    },
    {
      name: 'triage_unread_label_progress',
      value: labelProgress,
      comment: `[${ci.id}] unread newly labeled=${newlyLabeledUnreadEmailIds.length}, target>=${minNewlyLabeledUnread}`,
    },
    {
      name: 'triage_no_drafts',
      value: expectNoDrafts ? (draftsCreated === 0 ? 1 : 0) : 1,
      comment: `[${ci.id}] drafts created during triage=${draftsCreated}`,
    },
    {
      name: 'triage_account_consistency',
      value: accountMismatchCount === 0 ? 1 : 0,
      comment: `[${ci.id}] account mismatches=${accountMismatchCount}`,
    },
  ];
};

const main = async () => {
  const langfuse = new LangfuseClient();

  try {
    await ensureDataset(langfuse, {
      name: DATASET_NAME,
      description: 'Triage quality: verifies reply planning, labeling progress, and no draft creation',
      metadata: { domain: 'email-agent', kind: 'synthetic' },
    });

    await syncDatasetItems(langfuse, DATASET_NAME, toSeeds(rawCases));

    const dataset = await langfuse.dataset.get(DATASET_NAME);
    const result = await dataset.runExperiment({
      name: 'Triage — planning + labeling quality',
      metadata: { model: MODEL },
      task: async (item) => {
        resetMockInboxState();

        const ci = toCaseInput(item.input);
        const task = typeof ci.task === 'string'
          ? ci.task
          : 'Triage both inboxes and mark emails that need replies.';

        const unreadBefore = emails.filter((email) => !email.isRead);
        const beforeIndex = userLabelIndex();
        const beforeUserLabelCount = new Map(
          unreadBefore.map((email) => [
            email.id,
            countUserLabels(email.account, email.labelIds, beforeIndex),
          ]),
        );

        const triage = await runTriagePhase(MODEL, task);

        const afterIndex = userLabelIndex();
        const unreadAfter = emails.filter((email) => !email.isRead);
        const newlyLabeledUnreadEmailIds = unreadAfter
          .filter((email) => {
            const before = beforeUserLabelCount.get(email.id) ?? 0;
            const after = countUserLabels(email.account, email.labelIds, afterIndex);
            return after > before;
          })
          .map((email) => email.id);

        const replyEmailIds = [...new Set(triage.replyPlans.map((plan) => plan.emailId))];
        const accountMismatchCount = triage.replyPlans.filter((plan) => {
          const email = emails.find((entry) => entry.id === plan.emailId);
          return !email || email.account !== plan.account;
        }).length;

        return {
          turns: triage.turns,
          replyPlanCount: triage.replyPlans.length,
          replyEmailIds,
          newlyLabeledUnreadEmailIds,
          draftsCreated: drafts.length,
          accountMismatchCount,
        };
      },
      evaluators: [triageEvaluator],
      runEvaluators: [
        createAvgScoreEvaluator('triage_required_reply_coverage'),
        createAvgScoreEvaluator('triage_min_reply_plans'),
        createAvgScoreEvaluator('triage_unread_label_progress'),
        createAvgScoreEvaluator('triage_no_drafts'),
        createAvgScoreEvaluator('triage_account_consistency'),
      ],
      maxConcurrency: 1,
    });

    console.log(await result.format({ includeItemResults: true }));
  } finally {
    await langfuse.flush();
    await langfuse.shutdown();
  }
};

main().catch((err) => {
  console.error('Triage eval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
