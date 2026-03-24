import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PATHS } from '../config/index.js'
import type { HeartbeatEvent } from '../types.js'

const EVENTS_DIR = PATHS.EVENTS_DIR
const EVENTS_LOG_PATH = join(EVENTS_DIR, 'events.jsonl')

const ensureEventPath = async (): Promise<void> => {
  await mkdir(dirname(EVENTS_LOG_PATH), { recursive: true })
}

const stringifyEvent = (event: HeartbeatEvent): string => `${JSON.stringify(event)}\n`

export class EventStore {
  #roundEvents: HeartbeatEvent[] = []

  startRound(): void {
    this.#roundEvents = []
  }

  async emit(event: Omit<HeartbeatEvent, 'at'> & { at?: string }): Promise<HeartbeatEvent> {
    const fullEvent: HeartbeatEvent = {
      ...event,
      at: event.at ?? new Date().toISOString(),
    }

    this.#roundEvents.push(fullEvent)
    await ensureEventPath()
    await appendFile(EVENTS_LOG_PATH, stringifyEvent(fullEvent), 'utf-8')

    return fullEvent
  }

  getRoundEvents(): HeartbeatEvent[] {
    return [...this.#roundEvents]
  }

  async flushRound(round: number): Promise<string> {
    await mkdir(EVENTS_DIR, { recursive: true })

    const filename = `round-${String(round).padStart(3, '0')}.md`
    const path = join(EVENTS_DIR, filename)
    const lines = [
      '---',
      `round: ${round}`,
      `events: ${this.#roundEvents.length}`,
      `generated_at: ${new Date().toISOString()}`,
      '---',
      '',
      '# Heartbeat Round Events',
      '',
      ...this.#roundEvents.map((event) => {
        const core = `- \`${event.at}\` \`${event.type}\``
        const refs = [event.agent ? `agent=${event.agent}` : '', event.taskId ? `task=${event.taskId}` : '']
          .filter(Boolean)
          .join(' ')
        const payload = event.data ? ` data=${JSON.stringify(event.data)}` : ''
        const suffix = [refs, event.message].filter(Boolean).join(' | ')
        return `${core}${suffix ? ` ${suffix}` : ''}${payload}`
      }),
      '',
    ]

    await writeFile(path, lines.join('\n'), 'utf-8')
    return path
  }
}
