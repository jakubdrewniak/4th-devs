import { readFile } from 'node:fs/promises'
import type { LangfuseClient } from '@langfuse/client'
import type { Logger } from '../../src/core/logger.js'
import { err, ok, type Result } from '../../src/core/result.js'

export interface DatasetItemSeed {
  id: string
  input: unknown
  expectedOutput: unknown
  metadata?: Record<string, unknown>
}

interface DatasetConfig {
  name: string
  description: string
  metadata?: Record<string, unknown>
}

export const loadJsonFile = async <T>(path: string): Promise<Result<T, string>> => {
  try {
    const raw = await readFile(path, 'utf-8')
    return ok(JSON.parse(raw) as T)
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error))
  }
}

export const ensureDataset = async (
  langfuse: LangfuseClient,
  config: DatasetConfig,
  logger: Logger,
): Promise<void> => {
  try {
    await langfuse.api.datasets.get(config.name)
    logger.info('Dataset exists', { dataset: config.name })
    return
  } catch {
    // does not exist yet
  }

  await langfuse.api.datasets.create({
    name: config.name,
    description: config.description,
    metadata: config.metadata,
  })

  logger.info('Dataset created', { dataset: config.name })
}

export const syncDatasetItems = async (
  langfuse: LangfuseClient,
  datasetName: string,
  items: DatasetItemSeed[],
  logger: Logger,
): Promise<void> => {
  for (const item of items) {
    await langfuse.api.datasetItems.create({
      datasetName,
      id: item.id,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    })
  }

  logger.info('Dataset items synced', {
    dataset: datasetName,
    count: items.length,
  })
}
