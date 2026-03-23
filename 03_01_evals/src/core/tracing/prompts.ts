import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { LangfuseAPIClient } from '@langfuse/core'
import type { PromptRef } from './context.js'
import { logTrace } from './init.js'

interface PromptSyncEntry {
  contentHash: string
  version: number
}

interface PromptSyncState {
  prompts: Record<string, PromptSyncEntry>
}

interface PromptSource {
  name: string
  content: string
  tags: string[]
}

const STATE_FILE = '.langfuse-prompt-state.json'

const promptRefs = new Map<string, PromptRef>()

export const getPromptRefByName = (name: string): PromptRef | undefined => promptRefs.get(name)

const computeHash = (content: string): string => createHash('sha256').update(content).digest('hex')

const loadState = async (): Promise<PromptSyncState> => {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as PromptSyncState
  } catch {
    return { prompts: {} }
  }
}

const saveState = async (state: PromptSyncState): Promise<void> => {
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    logTrace('warn', 'Failed to save prompt sync state', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const collectPromptSources = async (): Promise<PromptSource[]> => {
  const { SYSTEM_PROMPT } = await import('../../agent/run.js')

  return [
    {
      name: 'agents/alice',
      content: SYSTEM_PROMPT,
      tags: ['agent-template'],
    },
  ]
}

const pushPrompt = async (client: LangfuseAPIClient, source: PromptSource): Promise<number | undefined> => {
  try {
    const result = await client.prompts.create({
      type: 'text',
      name: source.name,
      prompt: source.content,
      labels: ['production'],
      tags: source.tags,
    })

    logTrace('info', 'Pushed prompt to Langfuse', {
      name: source.name,
      version: result.version,
    })

    return result.version
  } catch (error) {
    logTrace('warn', 'Failed to push prompt to Langfuse', {
      name: source.name,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export const syncPrompts = async (): Promise<void> => {
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY

  if (!secretKey || !publicKey) {
    logTrace('info', 'Prompt sync skipped: missing Langfuse credentials')
    return
  }

  const baseUrl = process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com'
  const client = new LangfuseAPIClient({
    environment: baseUrl,
    username: publicKey,
    password: secretKey,
  })

  const state = await loadState()
  const sources = await collectPromptSources()

  let pushed = 0

  for (const source of sources) {
    const contentHash = computeHash(source.content)
    const cached = state.prompts[source.name]

    if (cached?.contentHash === contentHash) {
      promptRefs.set(source.name, {
        name: source.name,
        version: cached.version,
        isFallback: false,
      })
      continue
    }

    const version = await pushPrompt(client, source)

    if (version !== undefined) {
      state.prompts[source.name] = { contentHash, version }
      promptRefs.set(source.name, {
        name: source.name,
        version,
        isFallback: false,
      })
      pushed += 1
      continue
    }

    if (cached) {
      promptRefs.set(source.name, {
        name: source.name,
        version: cached.version,
        isFallback: true,
      })
    }
  }

  await saveState(state)

  logTrace('info', 'Prompt sync complete', {
    total: sources.length,
    pushed,
    cached: sources.length - pushed,
  })
}
