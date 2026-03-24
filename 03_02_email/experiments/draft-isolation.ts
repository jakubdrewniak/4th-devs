import { LangfuseClient, type Evaluator } from '@langfuse/client';
import {
  loadDataset, ensureDataset, syncDatasetItems,
  createAvgScoreEvaluator, toCaseInput,
  type DatasetItemSeed,
} from './lib/index.js';
import { runDraftEvalTask } from './lib/draft-task.js';

const DATASET_NAME = '03_02_email/draft-isolation';
const MODEL = process.env.MODEL ?? 'gpt-4.1';

interface IsolationCase {
  id: string;
  emailId: string;
  account: string;
  contactType: string;
  description: string;
  forbiddenTerms: string[];
  allowedTerms: string[];
}

const rawCases = loadDataset<IsolationCase>('draft-isolation');

const toSeeds = (cases: IsolationCase[]): DatasetItemSeed[] =>
  cases.map((c) => ({
    id: `draft_isolation_${c.id}`,
    input: { id: c.id, emailId: c.emailId, account: c.account, description: c.description },
    expectedOutput: { forbiddenTerms: c.forbiddenTerms, allowedTerms: c.allowedTerms },
    metadata: { contactType: c.contactType },
  }));

const isolationEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const caseInput = toCaseInput(input);
  const response = typeof output === 'object' && output != null && 'draft' in output
    ? String((output as { draft: unknown }).draft)
    : '';
  const lower = response.toLowerCase();
  const expected = (expectedOutput ?? {}) as { forbiddenTerms?: string[]; allowedTerms?: string[] };

  const forbidden = expected.forbiddenTerms ?? [];
  const allowed = expected.allowedTerms ?? [];
  const leaked = forbidden.filter((t) => lower.includes(t.toLowerCase()));
  const found = allowed.filter((t) => lower.includes(t.toLowerCase()));

  const scores = [
    {
      name: 'isolation',
      value: leaked.length === 0 ? 1 : 0,
      comment: leaked.length > 0 ? `[${caseInput.id}] Leaked: ${leaked.join(', ')}` : `[${caseInput.id}] No leaks`,
    },
  ];

  if (allowed.length > 0) {
    scores.push({
      name: 'relevance',
      value: found.length / allowed.length,
      comment: found.length < allowed.length
        ? `[${caseInput.id}] Missing: ${allowed.filter((t) => !lower.includes(t.toLowerCase())).join(', ')}`
        : `[${caseInput.id}] All expected terms present`,
    });
  }

  return scores;
};

const main = async () => {
  const langfuse = new LangfuseClient();

  try {
    await ensureDataset(langfuse, {
      name: DATASET_NAME,
      description: 'Draft isolation: verifies no forbidden terms leak across account/contact-type boundaries',
      metadata: { domain: 'email-agent', kind: 'synthetic' },
    });

    await syncDatasetItems(langfuse, DATASET_NAME, toSeeds(rawCases));

    const dataset = await langfuse.dataset.get(DATASET_NAME);
    const result = await dataset.runExperiment({
      name: 'Draft Isolation — forbidden term leakage',
      description: 'Checks that scoped KB prevents cross-account and cross-contact-type data leaks',
      metadata: { model: MODEL },
      task: async (item) => {
        const output = await runDraftEvalTask({ itemInput: item.input, model: MODEL });
        return { draft: output.draft, contactType: output.contactType };
      },
      evaluators: [isolationEvaluator],
      runEvaluators: [createAvgScoreEvaluator('isolation')],
      maxConcurrency: 2,
    });

    console.log(await result.format({ includeItemResults: true }));
  } finally {
    await langfuse.flush();
    await langfuse.shutdown();
  }
};

main().catch((err) => {
  console.error('Draft isolation eval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
