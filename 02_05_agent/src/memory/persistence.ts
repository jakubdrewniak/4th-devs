import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { MEMORY_DIR } from '../config.js'
import { log, logError } from '../helpers/log.js'

const pad = (n: number): string => String(n).padStart(3, '0')

const persistMemoryLog = async (
  prefix: string,
  seq: number,
  body: string,
  metadata: Record<string, string | number>,
): Promise<void> => {
  const filename = `${prefix}-${pad(seq)}.md`
  const path = join(MEMORY_DIR, filename)

  const frontmatter = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')

  const content = `---\n${frontmatter}\ncreated: ${new Date().toISOString()}\n---\n\n${body}\n`

  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
    log('memory', `💾 ${filename}`)
  } catch (err) {
    logError('memory', `Failed to write ${filename}:`, err)
  }
}

export const persistObserverLog = async (entry: {
  sessionId: string
  sequence: number
  observations: string
  tokens: number
  messagesObserved: number
  generation: number
  sealedRange: [number, number]
}): Promise<void> =>
  persistMemoryLog('observer', entry.sequence, entry.observations, {
    type: 'observation',
    session: entry.sessionId,
    sequence: entry.sequence,
    generation: entry.generation,
    tokens: entry.tokens,
    messages_observed: entry.messagesObserved,
    sealed_range: `${entry.sealedRange[0]}–${entry.sealedRange[1]}`,
  })

export const persistReflectorLog = async (entry: {
  sessionId: string
  sequence: number
  observations: string
  tokens: number
  generation: number
  compressionLevel: number
}): Promise<void> =>
  persistMemoryLog('reflector', entry.sequence, entry.observations, {
    type: 'reflection',
    session: entry.sessionId,
    sequence: entry.sequence,
    generation: entry.generation,
    tokens: entry.tokens,
    compression_level: entry.compressionLevel,
  })
