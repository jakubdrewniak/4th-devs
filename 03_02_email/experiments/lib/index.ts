import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LangfuseClient, type Evaluator, type RunEvaluator } from '@langfuse/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetsDir = join(__dirname, '..', 'datasets');

export const loadDataset = <T>(name: string): T[] =>
  JSON.parse(readFileSync(join(datasetsDir, `${name}.json`), 'utf-8'));

export interface DatasetItemSeed {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  metadata?: Record<string, unknown>;
}

export const ensureDataset = async (
  langfuse: LangfuseClient,
  config: { name: string; description: string; metadata?: Record<string, unknown> },
): Promise<void> => {
  try {
    await langfuse.api.datasets.get(config.name);
    console.log(`  Dataset exists: ${config.name}`);
    return;
  } catch { /* does not exist yet */ }

  await langfuse.api.datasets.create({
    name: config.name,
    description: config.description,
    metadata: config.metadata,
  });
  console.log(`  Dataset created: ${config.name}`);
};

export const syncDatasetItems = async (
  langfuse: LangfuseClient,
  datasetName: string,
  items: DatasetItemSeed[],
): Promise<void> => {
  for (const item of items) {
    await langfuse.api.datasetItems.create({
      datasetName,
      id: item.id,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    });
  }
  console.log(`  Synced ${items.length} items to ${datasetName}`);
};

export const createAvgScoreEvaluator = (scoreName: string): RunEvaluator =>
  async ({ itemResults }) => {
    const scores = itemResults
      .flatMap((item) => item.evaluations)
      .filter((e) => e.name === scoreName)
      .map((e) => e.value)
      .filter((v): v is number => typeof v === 'number');

    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      name: `avg_${scoreName}`,
      value: avg,
      comment: `${(avg * 100).toFixed(1)}% across ${scores.length} items`,
    };
  };

export const toCaseInput = (item: unknown): { id: string; [key: string]: unknown } => {
  if (typeof item !== 'object' || item == null) return { id: 'unknown' };
  const candidate = item as Record<string, unknown>;
  return { ...candidate, id: typeof candidate.id === 'string' ? candidate.id : 'unknown' };
};

export { type Evaluator, type RunEvaluator, type LangfuseClient };
