import { readFile, writeFile } from 'node:fs/promises'
import { PATHS } from '../config.js'
import type { AwarenessState } from '../types.js'

export const loadAwarenessState = async (): Promise<AwarenessState> => {
  const raw = await readFile(PATHS.awarenessStatePath, 'utf-8').catch(() => '')
  if (!raw.trim()) return { turnsSinceScout: 0 }
  try {
    const parsed = JSON.parse(raw) as AwarenessState
    return {
      turnsSinceScout: typeof parsed.turnsSinceScout === 'number' ? parsed.turnsSinceScout : 0,
      lastScoutAt: parsed.lastScoutAt,
      lastScoutReason: parsed.lastScoutReason,
    }
  } catch {
    return { turnsSinceScout: 0 }
  }
}

export const saveAwarenessState = async (state: AwarenessState): Promise<void> => {
  await writeFile(PATHS.awarenessStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}
