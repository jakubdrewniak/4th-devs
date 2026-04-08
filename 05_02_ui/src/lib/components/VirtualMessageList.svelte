<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import MessageCard from './MessageCard.svelte'
  import type { UiMessage } from '../stores/chat-store.svelte'

  const IS_DEV = import.meta.env.DEV
  const CHUNK_SIZE = 12
  const OVERSCAN_CHUNKS = 3
  const DEFAULT_MESSAGE_HEIGHT = 220
  const PIN_RELEASE_DISTANCE = 80
  const PIN_REACQUIRE_DISTANCE = 4

  interface Props {
    messages?: UiMessage[]
    streamPulse?: number
    isLoading?: boolean
    /** Increment in parent to pin to bottom and jump scroll (submit, restart). */
    pinToBottomToken?: number
  }

  let {
    messages = [],
    streamPulse = 0,
    isLoading = false,
    pinToBottomToken = 0,
  }: Props = $props()

  let viewport: HTMLDivElement | null = $state(null)
  let content: HTMLDivElement | null = $state(null)
  let pinnedToBottom = $state(true)
  let scrollTop = $state(0)
  let viewportHeight = $state(0)
  let chunkHeights = $state(new Map<number, number>())

  let scrollGuardUntil = 0
  let bottomLockUntil = 0
  let scrollDebugEnabled = false
  let previousLayoutDebugKey = ''
  let lastHandledPinToBottomToken = 0

  let previousFirstMessageId = ''
  let previousMessageCount = 0

  type MessageChunk = {
    index: number
    messages: UiMessage[]
    startIndex: number
  }

  type ChunkMetric = MessageChunk & {
    endOffset: number
    height: number
    startOffset: number
  }

  const chunks = $derived.by(() => {
    const result: MessageChunk[] = []

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      result.push({
        index: result.length,
        messages: messages.slice(i, i + CHUNK_SIZE),
        startIndex: i,
      })
    }

    return result
  })

  const lastChunkIndex = $derived(chunks.length - 1)

  const latestAssistantMessageId = $derived.by(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') {
        return messages[i].id
      }
    }

    return null
  })

  const averageMessageHeight = $derived.by(() => {
    let measuredHeight = 0
    let measuredMessages = 0

    for (const chunk of chunks) {
      const height = chunkHeights.get(chunk.index)
      if (height == null) {
        continue
      }

      measuredHeight += height
      measuredMessages += chunk.messages.length
    }

    return measuredMessages > 0
      ? measuredHeight / measuredMessages
      : DEFAULT_MESSAGE_HEIGHT
  })

  const chunkMetrics = $derived.by(() => {
    let offset = 0
    const metrics: ChunkMetric[] = []

    for (const chunk of chunks) {
      const estimatedHeight =
        chunkHeights.get(chunk.index) ??
        Math.max(
          chunk.messages.length * averageMessageHeight,
          chunk.messages.length * DEFAULT_MESSAGE_HEIGHT * 0.75,
        )

      metrics.push({
        ...chunk,
        startOffset: offset,
        height: estimatedHeight,
        endOffset: offset + estimatedHeight,
      })

      offset += estimatedHeight
    }

    return metrics
  })

  const totalHeight = $derived(
    chunkMetrics.length > 0
      ? chunkMetrics[chunkMetrics.length - 1].endOffset
      : 0
  )

  const visibleRange = $derived.by(() => {
    if (chunkMetrics.length === 0) {
      return { start: 0, end: 0 }
    }

    if (pinnedToBottom) {
      const targetTop = Math.max(0, totalHeight - Math.max(viewportHeight, 1))
      let start = chunkMetrics.length - 1

      while (
        start > 0 &&
        chunkMetrics[start].startOffset > targetTop
      ) {
        start -= 1
      }

      return {
        start: Math.max(0, start - OVERSCAN_CHUNKS),
        end: chunkMetrics.length,
      }
    }

    const top = scrollTop
    const bottom = scrollTop + Math.max(viewportHeight, 1)

    let start = 0
    while (
      start < chunkMetrics.length &&
      chunkMetrics[start].endOffset < top
    ) {
      start += 1
    }

    let end = start
    while (
      end < chunkMetrics.length &&
      chunkMetrics[end].startOffset <= bottom
    ) {
      end += 1
    }

    const rangeStart = Math.max(0, start - OVERSCAN_CHUNKS)
    const naturalEnd = Math.min(
      chunkMetrics.length,
      Math.max(end + OVERSCAN_CHUNKS, start + 1),
    )

    const nearTail = chunkMetrics.length - naturalEnd <= OVERSCAN_CHUNKS
    const rangeEnd = nearTail ? chunkMetrics.length : naturalEnd

    return { start: rangeStart, end: rangeEnd }
  })

  const renderedChunks = $derived(
    chunkMetrics.slice(visibleRange.start, visibleRange.end)
  )

  const topSpacerHeight = $derived(
    renderedChunks.length > 0 ? renderedChunks[0].startOffset : 0
  )

  const bottomSpacerHeight = $derived.by(() => {
    if (pinnedToBottom || renderedChunks.length === 0) return 0
    const lastRendered = renderedChunks[renderedChunks.length - 1]
    return Math.max(0, totalHeight - lastRendered.endOffset)
  })

  const getScrollSnapshot = (): Record<string, number | boolean | null> => {
    const now = performance.now()

    return {
      atMs: Math.round(now),
      messages: messages.length,
      pinnedToBottom,
      scrollTop: Math.round(scrollTop),
      viewportScrollTop: viewport ? Math.round(viewport.scrollTop) : null,
      viewportHeight: Math.round(viewportHeight),
      viewportClientHeight: viewport ? Math.round(viewport.clientHeight) : null,
      viewportScrollHeight: viewport ? Math.round(viewport.scrollHeight) : null,
      totalHeight: Math.round(totalHeight),
      topSpacerHeight: Math.round(topSpacerHeight),
      bottomSpacerHeight: Math.round(bottomSpacerHeight),
      visibleRangeStart: visibleRange.start,
      visibleRangeEnd: visibleRange.end,
      renderedChunkStart: renderedChunks[0]?.index ?? null,
      renderedChunkEnd: renderedChunks[renderedChunks.length - 1]?.index ?? null,
      renderedChunkCount: renderedChunks.length,
      lastChunkIndex,
      scrollGuardForMs: Math.max(0, Math.round(scrollGuardUntil - now)),
      bottomLockForMs: Math.max(0, Math.round(bottomLockUntil - now)),
    }
  }

  const logScroll = (
    event: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!IS_DEV || typeof window === 'undefined') {
      return
    }

    untrack(() => {
      if (!scrollDebugEnabled) {
        return
      }

      console.log(`[scroll] ${event}`, {
        ...getScrollSnapshot(),
        ...extra,
      })
    })
  }

  const distanceFromViewportBottom = (): number => {
    if (!viewport) {
      return Number.POSITIVE_INFINITY
    }

    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  }

  const updateChunkHeight = (chunkIndex: number, nextHeight: number) => {
    const height = Math.ceil(nextHeight)
    const current = chunkHeights.get(chunkIndex)

    if (current === height) {
      return
    }

    // Scroll anchoring: if a chunk above the viewport changed height,
    // compensate scrollTop so the visible content doesn't shift.
    if (current != null && viewport && !pinnedToBottom) {
      const distanceFromBottom = distanceFromViewportBottom()
      const shouldSkipAnchor =
        distanceFromBottom < Math.max(viewport.clientHeight, DEFAULT_MESSAGE_HEIGHT)

      if (shouldSkipAnchor) {
        logScroll('anchorSkippedNearBottom', {
          chunkIndex,
          distanceFromBottom: Math.round(distanceFromBottom),
        })
      } else {
        const metric = chunkMetrics[chunkIndex]
        if (metric && metric.endOffset < scrollTop) {
          const delta = height - current
          scrollGuardUntil = performance.now() + 150
          viewport.scrollTop += delta
          scrollTop = viewport.scrollTop
          logScroll('anchorAboveViewport', {
            chunkIndex,
            previousHeight: current,
            nextHeight: height,
            delta,
            metricEndOffset: Math.round(metric.endOffset),
          })
        }
      }
    }

    const next = new Map(chunkHeights)
    next.set(chunkIndex, height)
    chunkHeights = next
  }

  const measureChunk = (node: HTMLDivElement, chunkIndex: number) => {
    const measure = () => {
      updateChunkHeight(chunkIndex, node.getBoundingClientRect().height)
    }

    measure()

    const observer = new ResizeObserver(() => {
      measure()
    })

    observer.observe(node)

    return {
      destroy() {
        observer.disconnect()
      },
    }
  }

  const lockToBottom = (durationMs: number) => {
    const nextLockUntil = performance.now() + durationMs
    bottomLockUntil = Math.max(bottomLockUntil, nextLockUntil)
    pinnedToBottom = true
    logScroll('lockToBottom', { durationMs })
  }

  const scrollToEnd = (guardMs = 100) => {
    if (!viewport) return
    const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    scrollGuardUntil = performance.now() + guardMs
    viewport.scrollTop = target
    scrollTop = viewport.scrollTop
    logScroll('scrollToEnd', {
      guardMs,
      targetScrollTop: Math.round(target),
      appliedScrollTop: Math.round(viewport.scrollTop),
    })
  }

  const handleScroll = () => {
    if (!viewport) return

    const previousPinned = pinnedToBottom
    scrollTop = viewport.scrollTop

    const now = performance.now()
    if (now < scrollGuardUntil || now < bottomLockUntil) {
      pinnedToBottom = true
      if (!previousPinned) {
        logScroll('handleScrollGuardedRepin', {
          inScrollGuard: now < scrollGuardUntil,
          inBottomLock: now < bottomLockUntil,
        })
      }
      return
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const nextPinned = previousPinned
      ? distanceFromBottom < PIN_RELEASE_DISTANCE
      : distanceFromBottom < PIN_REACQUIRE_DISTANCE
    pinnedToBottom = nextPinned

    if (nextPinned !== previousPinned) {
      logScroll(nextPinned ? 'handleScrollPinned' : 'handleScrollUnpinned', {
        distanceFromBottom: Math.round(distanceFromBottom),
      })
    }
  }

  const jumpToBottom = async () => {
    logScroll('jumpToBottomStart')

    // Pre-position the reactive scrollTop so visibleRange renders bottom chunks
    // WITHOUT touching viewport.scrollTop. If we set viewport.scrollTop before
    // the tick, the browser clamps it when the bottom spacer is removed (shrinking
    // scrollHeight), causing the visible bounce-back. By only updating state here
    // and letting the DOM scroll happen once after the tick, we get a single
    // clean jump with no intermediate clamping.
    if (viewport) {
      scrollTop = Math.max(0, totalHeight - Math.max(viewport.clientHeight, 1))
      logScroll('jumpToBottomPreposition', {
        prepositionedScrollTop: Math.round(scrollTop),
      })
    }

    lockToBottom(1000)
    await tick()
    logScroll('jumpToBottomAfterTick')
    scrollToEnd(400)
    requestAnimationFrame(() => {
      logScroll('jumpToBottomRaf')
      scrollToEnd(200)
    })
  }

  // Parent-driven pin (after send / restart): stay pinned and follow stream until user scrolls away.
  $effect(() => {
    const token = pinToBottomToken
    if (token === 0 || token === lastHandledPinToBottomToken) return

    lastHandledPinToBottomToken = token
    logScroll('pinToBottomToken', { token })
    untrack(() => {
      void jumpToBottom()
    })
  })

  // Watchdog: any store update while pinned scrolls to bottom once.
  $effect(() => {
    const pulse = streamPulse
    if (pulse === 0) return

    const shouldFollow = untrack(() => pinnedToBottom && !!viewport)
    if (!shouldFollow) return

    logScroll('streamPulseFollow', { streamPulse: pulse })
    requestAnimationFrame(() => scrollToEnd())
  })

  // Primary bottom-follow: when content resizes (streaming text grows,
  // new chunks mount), scroll to bottom if pinned. No rAF loop needed.
  $effect(() => {
    if (!content) return

    const ro = new ResizeObserver(() => {
      if (pinnedToBottom && viewport) {
        logScroll('contentResizeFollow')
        scrollToEnd()
      }
    })

    ro.observe(content)
    return () => ro.disconnect()
  })

  $effect(() => {
    if (!viewport) return

    viewportHeight = viewport.clientHeight

    const ro = new ResizeObserver(() => {
      if (!viewport) return
      viewportHeight = viewport.clientHeight
    })

    ro.observe(viewport)
    return () => ro.disconnect()
  })

  $effect(() => {
    const firstMessageId = messages[0]?.id ?? ''
    const currentCount = messages.length

    if (
      firstMessageId !== previousFirstMessageId ||
      currentCount < previousMessageCount
    ) {
      chunkHeights = new Map()
      scrollTop = 0
      logScroll('resetChunkHeights', {
        firstMessageId,
        previousFirstMessageId,
        currentCount,
        previousMessageCount,
      })
    }

    previousFirstMessageId = firstMessageId
    previousMessageCount = currentCount
  })

  onMount(() => {
    if (IS_DEV && typeof window !== 'undefined') {
      const globalWindow = window as unknown as Record<string, unknown>

      globalWindow.__scrollSnapshot = () => {
        console.log('[scroll] manual snapshot', getScrollSnapshot())
      }
      globalWindow.__scrollDebugOn = () => {
        scrollDebugEnabled = true
        console.log('[scroll] debug on')
      }
      globalWindow.__scrollDebugOff = () => {
        scrollDebugEnabled = false
        console.log('[scroll] debug off')
      }

      console.log(
        '%c[scroll] debug available%c  call %c__scrollDebugOn()%c to enable, %c__scrollSnapshot()%c for state',
        'color:#38bdf8;font-weight:600',
        'color:inherit',
        'color:#b4a9f8;font-family:monospace',
        'color:inherit',
        'color:#b4a9f8;font-family:monospace',
        'color:inherit',
      )
    }

    if (viewport) {
      viewportHeight = viewport.clientHeight
    }
    scrollToEnd()
  })

  $effect(() => {
    const layoutDebugKey = [
      pinnedToBottom ? '1' : '0',
      Math.round(scrollTop),
      visibleRange.start,
      visibleRange.end,
      Math.round(topSpacerHeight),
      Math.round(bottomSpacerHeight),
    ].join(':')

    if (layoutDebugKey === previousLayoutDebugKey) {
      return
    }

    previousLayoutDebugKey = layoutDebugKey
    logScroll('layout')
  })
</script>

<div class="relative flex-1 min-h-0">
  {#if isLoading && messages.length === 0}
    <div class="max-w-3xl mx-auto w-full px-5 py-10">
      <div class="space-y-8">
        {#each [0.5, 0.3, 0.15] as opacity (opacity)}
          <div class="flex items-start gap-3" style="opacity: {opacity};">
            <div class="w-6 h-6 rounded-full bg-surface-2 shrink-0 shimmer"></div>
            <div class="flex-1 space-y-2 pt-1">
              <div class="h-3 w-20 rounded bg-surface-2 shimmer"></div>
              <div class="h-12 w-3/4 rounded-lg bg-surface-2 shimmer"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if messages.length === 0}
    <div class="flex items-center justify-center h-full px-6">
      <div class="text-center max-w-xs">
        <div class="mx-auto w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-5 h-5 text-text-tertiary" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 13a2 2 0 0 1-2 2H7l-4 3.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <p class="text-[14px] font-medium text-text-primary mb-1">No messages yet</p>
        <p class="text-[13px] text-text-tertiary leading-relaxed">Send a prompt to start a streaming agent turn.</p>
      </div>
    </div>
  {:else}
    <div
      bind:this={viewport}
      onscroll={handleScroll}
      class="absolute inset-0 overflow-y-auto overscroll-contain"
      style="scrollbar-gutter: stable; overflow-anchor: none;"
    >
      <div bind:this={content} class="max-w-3xl mx-auto px-5 py-4">
        {#if topSpacerHeight > 0}
          <div
            aria-hidden="true"
            style={`height: ${topSpacerHeight}px;`}
          ></div>
        {/if}

        {#each renderedChunks as chunk (chunk.index)}
          <div use:measureChunk={chunk.index}>
            {#each chunk.messages as message (message.id)}
              <MessageCard
                {message}
                isLatest={message.id === latestAssistantMessageId}
              />
            {/each}
          </div>
        {/each}

        {#if bottomSpacerHeight > 0}
          <div
            aria-hidden="true"
            style={`height: ${bottomSpacerHeight}px;`}
          ></div>
        {/if}
      </div>
    </div>

    {#if !pinnedToBottom}
      <button
        class="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 h-7 px-3 rounded-full bg-surface-3 border border-border-strong text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
        onclick={jumpToBottom}
        transition:fly={{ y: 6, duration: 120 }}
      >
        <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5"/>
        </svg>
        Scroll to bottom
      </button>
    {/if}
  {/if}
</div>

<style>
  .shimmer {
    animation: shimmer 2s infinite linear;
    background-image: linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%);
    background-size: 200% 100%;
  }
</style>
