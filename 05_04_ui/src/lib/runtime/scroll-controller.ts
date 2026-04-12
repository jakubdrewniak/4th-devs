export interface ScrollControllerState {
  pinnedToBottom: boolean
  scrollTop: number
  viewportHeight: number
}

export interface ScrollViewportLike {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
  scrollTo: (options: ScrollToOptions) => void
}

export interface ScrollChunkMetric {
  endOffset: number
}

interface JumpToBottomOptions {
  awaitTick: () => Promise<void>
  schedule: (task: () => void) => void
}

interface CreateScrollControllerOptions {
  defaultMessageHeight: number
  getChunkHeights: () => ReadonlyMap<number, number>
  getChunkMetric: (chunkIndex: number) => ScrollChunkMetric | undefined
  getTotalHeight: () => number
  getViewport: () => ScrollViewportLike | null
  log?: (event: string, extra?: Record<string, unknown>) => void
  now?: () => number
  pinReacquireDistance: number
  pinReleaseDistance: number
  setChunkHeights: (next: Map<number, number>) => void
  state: ScrollControllerState
}

export interface ScrollController {
  followStreamPulse: (schedule: (task: () => void) => void) => void
  getTimingState: () => { bottomLockUntil: number; scrollGuardUntil: number }
  handleContentResize: () => void
  handleScroll: () => void
  jumpToBottom: (options: JumpToBottomOptions) => Promise<void>
  lockToBottom: (durationMs: number) => void
  scrollToEnd: (guardMs?: number, behavior?: ScrollBehavior) => void
  syncViewportHeight: () => void
  updateChunkHeight: (chunkIndex: number, nextHeight: number) => void
}

export const createScrollController = ({
  defaultMessageHeight,
  getChunkHeights,
  getChunkMetric,
  getTotalHeight,
  getViewport,
  log,
  now = () => performance.now(),
  pinReacquireDistance,
  pinReleaseDistance,
  setChunkHeights,
  state,
}: CreateScrollControllerOptions): ScrollController => {
  let scrollGuardUntil = 0
  let bottomLockUntil = 0

  const distanceFromViewportBottom = (): number => {
    const viewport = getViewport()
    if (!viewport) {
      return Number.POSITIVE_INFINITY
    }

    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  }

  const lockToBottom = (durationMs: number): void => {
    const nextLockUntil = now() + durationMs
    bottomLockUntil = Math.max(bottomLockUntil, nextLockUntil)
    state.pinnedToBottom = true
    log?.('lockToBottom', { durationMs })
  }

  const scrollToEnd = (guardMs = 100, behavior: ScrollBehavior = 'instant'): void => {
    const viewport = getViewport()
    if (!viewport) {
      return
    }

    const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    scrollGuardUntil = now() + guardMs
    viewport.scrollTo({ top: target, behavior })
    state.scrollTop = target
    log?.('scrollToEnd', {
      guardMs,
      behavior,
      targetScrollTop: Math.round(target),
      appliedScrollTop: Math.round(viewport.scrollTop),
    })
  }

  const handleScroll = (): void => {
    const viewport = getViewport()
    if (!viewport) {
      return
    }

    const previousPinned = state.pinnedToBottom
    const previousScrollTop = state.scrollTop
    state.scrollTop = viewport.scrollTop

    // User scrolled up → immediately unpin, even during guards/locks.
    // During streaming, programmatic scrolls only push scrollTop down,
    // so a decrease is a reliable signal of user-initiated scroll-up.
    if (previousPinned && viewport.scrollTop < previousScrollTop - 1) {
      state.pinnedToBottom = false
      scrollGuardUntil = 0
      bottomLockUntil = 0
      log?.('handleScrollUserScrolledUp', {
        previousScrollTop: Math.round(previousScrollTop),
        currentScrollTop: Math.round(viewport.scrollTop),
      })
      return
    }

    const currentTime = now()
    if (currentTime < scrollGuardUntil || currentTime < bottomLockUntil) {
      state.pinnedToBottom = true
      if (!previousPinned) {
        log?.('handleScrollGuardedRepin', {
          inScrollGuard: currentTime < scrollGuardUntil,
          inBottomLock: currentTime < bottomLockUntil,
        })
      }
      return
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const nextPinned = previousPinned
      ? distanceFromBottom < pinReleaseDistance
      : distanceFromBottom < pinReacquireDistance
    state.pinnedToBottom = nextPinned

    if (nextPinned !== previousPinned) {
      log?.(nextPinned ? 'handleScrollPinned' : 'handleScrollUnpinned', {
        distanceFromBottom: Math.round(distanceFromBottom),
      })
    }
  }

  const jumpToBottom = async ({ awaitTick, schedule }: JumpToBottomOptions): Promise<void> => {
    log?.('jumpToBottomStart')

    const viewport = getViewport()
    if (viewport) {
      state.scrollTop = Math.max(0, getTotalHeight() - Math.max(viewport.clientHeight, 1))
      log?.('jumpToBottomPreposition', {
        prepositionedScrollTop: Math.round(state.scrollTop),
      })
    }

    lockToBottom(1000)
    await awaitTick()
    log?.('jumpToBottomAfterTick')
    scrollToEnd(400)
    schedule(() => {
      log?.('jumpToBottomRaf')
      scrollToEnd(200)
    })
  }

  const followStreamPulse = (schedule: (task: () => void) => void): void => {
    if (!state.pinnedToBottom || !getViewport()) {
      return
    }

    log?.('streamPulseFollow')
    schedule(() => scrollToEnd(100))
  }

  const handleContentResize = (): void => {
    if (!state.pinnedToBottom || !getViewport()) {
      return
    }

    log?.('contentResizeFollow')
    scrollToEnd(100)
  }

  const syncViewportHeight = (): void => {
    const viewport = getViewport()
    if (!viewport) {
      return
    }

    state.viewportHeight = viewport.clientHeight
  }

  const updateChunkHeight = (chunkIndex: number, nextHeight: number): void => {
    const height = Math.ceil(nextHeight)
    const current = getChunkHeights().get(chunkIndex)

    if (current === height) {
      return
    }

    const viewport = getViewport()
    if (current != null && viewport && !state.pinnedToBottom) {
      const distanceFromBottom = distanceFromViewportBottom()
      const shouldSkipAnchor =
        distanceFromBottom < Math.max(viewport.clientHeight, defaultMessageHeight)

      if (shouldSkipAnchor) {
        log?.('anchorSkippedNearBottom', {
          chunkIndex,
          distanceFromBottom: Math.round(distanceFromBottom),
        })
      } else {
        const metric = getChunkMetric(chunkIndex)
        if (metric && metric.endOffset < state.scrollTop) {
          const delta = height - current
          scrollGuardUntil = now() + 150
          viewport.scrollTop += delta
          state.scrollTop = viewport.scrollTop
          log?.('anchorAboveViewport', {
            chunkIndex,
            previousHeight: current,
            nextHeight: height,
            delta,
            metricEndOffset: Math.round(metric.endOffset),
          })
        }
      }
    }

    const next = new Map(getChunkHeights())
    next.set(chunkIndex, height)
    setChunkHeights(next)
  }

  return {
    followStreamPulse,
    getTimingState() {
      return {
        bottomLockUntil,
        scrollGuardUntil,
      }
    },
    handleContentResize,
    handleScroll,
    jumpToBottom,
    lockToBottom,
    scrollToEnd,
    syncViewportHeight,
    updateChunkHeight,
  }
}
