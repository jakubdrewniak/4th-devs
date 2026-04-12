import { describe, expect, test } from 'vitest'

import { shouldEnableTypewriterGate } from './typewriter-gating'

describe('shouldEnableTypewriterGate', () => {
  test('disables typewriter finishing when the message was cancelled', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'cancelled',
        isLatest: true,
        messageWasStreaming: true,
      }),
    ).toBe(false)
  })

  test('keeps typewriter finishing enabled for normal completed messages', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isLatest: true,
        messageWasStreaming: true,
      }),
    ).toBe(true)
  })

  test('disables typewriter for durable text handoff replay after streamed text already rendered', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isDurableTextHandoffReplay: true,
        isLatest: true,
        messageWasStreaming: true,
      }),
    ).toBe(false)
  })
})
