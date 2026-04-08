import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '../../shared/chat'
import type { PendingToolCall } from './types'

export const buildEventFactory = (assistantMessageId: string, initialSeq: number) => {
  let seq = initialSeq

  return <TType extends StreamEvent['type']>(
    type: TType,
    payload: Omit<Extract<StreamEvent, { type: TType }>, 'id' | 'type' | 'messageId' | 'seq' | 'at'>,
  ): Extract<StreamEvent, { type: TType }> => {
    const event = {
      id: randomUUID(),
      type,
      messageId: assistantMessageId,
      seq,
      at: new Date().toISOString(),
      ...payload,
    } as Extract<StreamEvent, { type: TType }>

    seq += 1
    return event
  }
}

export const findPendingCallById = (
  pendingCalls: Map<number, PendingToolCall>,
  callId: string | undefined,
): PendingToolCall | undefined => {
  if (!callId) {
    return undefined
  }

  return [...pendingCalls.values()].find(call => call.callId === callId)
}
