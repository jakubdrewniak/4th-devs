import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '../../shared/chat'
import type { BuiltScenario, MockStep } from './types'

export const createBuilder = (messageId: string, startSeq: number, startAt: number) => {
  let seq = startSeq
  let at = startAt
  const steps: MockStep[] = []
  const events: StreamEvent[] = []

  const push = <TType extends StreamEvent['type']>(
    type: TType,
    payload: Omit<Extract<StreamEvent, { type: TType }>, 'id' | 'type' | 'messageId' | 'seq' | 'at'>,
    delayMs = 0,
    sideEffect?: () => Promise<void>,
  ): Extract<StreamEvent, { type: TType }> => {
    at += delayMs

    const event = {
      id: randomUUID(),
      type,
      messageId,
      seq,
      at: new Date(at).toISOString(),
      ...payload,
    } as Extract<StreamEvent, { type: TType }>

    seq += 1
    steps.push({ delayMs, event, sideEffect })
    events.push(event)
    return event
  }

  const streamText = (text: string, initialDelay: number, chunkDelay = 35): void => {
    const chunkSize = 24
    let pos = 0
    let isFirst = true

    while (pos < text.length) {
      let end = Math.min(pos + chunkSize, text.length)
      if (end < text.length && text[end] !== ' ' && text[end] !== '\n') {
        const spaceIdx = text.indexOf(' ', end)
        const nlIdx = text.indexOf('\n', end)
        const nextBreak = Math.min(
          spaceIdx === -1 ? Infinity : spaceIdx,
          nlIdx === -1 ? Infinity : nlIdx,
        )
        if (nextBreak !== Infinity && nextBreak - end < 15) {
          end = nextBreak + 1
        }
      }

      push('text_delta', { textDelta: text.slice(pos, end) }, isFirst ? initialDelay : chunkDelay)
      pos = end
      isFirst = false
    }
  }

  return {
    push,
    streamText,
    build(): BuiltScenario {
      return {
        steps,
        events,
        nextSeq: seq,
      }
    },
  }
}
