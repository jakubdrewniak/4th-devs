import { LangfuseClient, type Evaluator } from '@langfuse/client';
import {
  loadDataset, ensureDataset, syncDatasetItems,
  createAvgScoreEvaluator, toCaseInput,
  type DatasetItemSeed,
} from './lib/index.js';
import { runDraftEvalTask } from './lib/draft-task.js';

const DATASET_NAME = '03_02_email/draft-language';
const MODEL = process.env.MODEL ?? 'gpt-4.1';

interface LanguageCase {
  id: string;
  emailId: string;
  account: string;
  description: string;
  expectedLanguage: string;
  mustContain: string[];
  mustNotContain: string[];
}

const rawCases = loadDataset<LanguageCase>('draft-language');

const toSeeds = (cases: LanguageCase[]): DatasetItemSeed[] =>
  cases.map((c) => ({
    id: `draft_language_${c.id}`,
    input: { id: c.id, emailId: c.emailId, account: c.account, description: c.description },
    expectedOutput: { expectedLanguage: c.expectedLanguage, mustContain: c.mustContain, mustNotContain: c.mustNotContain },
    metadata: { expectedLanguage: c.expectedLanguage },
  }));

const languageEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const ci = toCaseInput(input);
  const response = typeof output === 'object' && output != null && 'draft' in output
    ? String((output as { draft: unknown }).draft) : '';
  const expected = (expectedOutput ?? {}) as { mustContain?: string[]; mustNotContain?: string[] };

  const mustContain = expected.mustContain ?? [];
  const mustNotContain = expected.mustNotContain ?? [];
  const present = mustContain.filter((t) => response.includes(t));
  const absent = mustNotContain.filter((t) => response.includes(t));

  return [
    {
      name: 'language_contains',
      value: mustContain.length > 0 ? present.length / mustContain.length : 1,
      comment: present.length < mustContain.length
        ? `[${ci.id}] Missing: ${mustContain.filter((t) => !response.includes(t)).join(', ')}`
        : `[${ci.id}] OK`,
    },
    {
      name: 'language_no_forbidden',
      value: absent.length === 0 ? 1 : 0,
      comment: absent.length > 0 ? `[${ci.id}] Found forbidden: ${absent.join(', ')}` : `[${ci.id}] OK`,
    },
  ];
};

const main = async () => {
  const langfuse = new LangfuseClient();

  try {
    await ensureDataset(langfuse, {
      name: DATASET_NAME,
      description: 'Draft language: verifies replies use the correct language per contact',
      metadata: { domain: 'email-agent', kind: 'synthetic' },
    });

    await syncDatasetItems(langfuse, DATASET_NAME, toSeeds(rawCases));

    const dataset = await langfuse.dataset.get(DATASET_NAME);
    const result = await dataset.runExperiment({
      name: 'Draft Language — correct language per contact',
      metadata: { model: MODEL },
      task: async (item) => {
        const output = await runDraftEvalTask({ itemInput: item.input, model: MODEL });
        return { draft: output.draft };
      },
      evaluators: [languageEvaluator],
      runEvaluators: [createAvgScoreEvaluator('language_contains'), createAvgScoreEvaluator('language_no_forbidden')],
      maxConcurrency: 2,
    });

    console.log(await result.format({ includeItemResults: true }));
  } finally {
    await langfuse.flush();
    await langfuse.shutdown();
  }
};

main().catch((err) => {
  console.error('Draft language eval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
