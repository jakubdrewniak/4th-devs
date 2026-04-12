import type { MessageFinishReason } from '../../../../shared/chat'

export const shouldEnableTypewriterGate = (input: {
  enabled: boolean
  finishReason: MessageFinishReason | null
  isDurableTextHandoffReplay?: boolean
  isLatest: boolean
  messageWasStreaming: boolean
}): boolean =>
  input.enabled &&
  input.isLatest &&
  input.messageWasStreaming &&
  !input.isDurableTextHandoffReplay &&
  input.finishReason !== 'cancelled'
