<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    MarkdownSegment,
    MessageStatus,
    TextBlock as TextBlockModel,
    TextRenderState,
  } from '../../../shared/chat'
  import { repairIncompleteMarkdown } from '../runtime/incomplete-markdown'
  import { typewriter } from '../stores/typewriter.svelte'
  import MarkdownHtml from './MarkdownHtml.svelte'

  interface Props {
    block: TextBlockModel
    isLatest?: boolean
    messageStatus?: MessageStatus
    shouldTypewrite?: boolean
    oncomplete?: () => void
  }

  const EMPTY_RENDER_STATE: TextRenderState = {
    committedSegments: [],
    liveTail: '',
    processedContent: '',
    nextSegmentIndex: 0,
  }

  let { block, isLatest = false, messageStatus = 'complete', shouldTypewrite = false, oncomplete }: Props = $props()

  let displayedLength = $state(0)
  let frameId: number | null = null
  let nextTickAt = 0
  let completeFired = false
  let pageVisible = $state(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )
  let activeBlockId = $state('')
  let appliedRenderState: TextRenderState = $state.raw(EMPTY_RENDER_STATE)
  let pendingRenderState: TextRenderState | null = $state.raw(null)
  let liveTailElement: HTMLDivElement | null = $state(null)

  const shouldAnimate = $derived(
    shouldTypewrite &&
    displayedLength < block.content.length &&
    pageVisible
  )

  const visibleCharacterCount = $derived(
    shouldTypewrite
      ? Math.min(displayedLength, appliedRenderState.processedContent.length)
      : appliedRenderState.processedContent.length
  )

  const isRevealed = $derived(
    !shouldTypewrite || displayedLength >= block.content.length
  )

  const hasRangeSelectionWithin = (
    node: HTMLDivElement | null,
  ): boolean => {
    if (!node || typeof window === 'undefined') {
      return false
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false
    }

    const range = selection.getRangeAt(0)
    return (
      node.contains(range.startContainer) ||
      node.contains(range.endContainer)
    )
  }

  const applyRenderState = (nextRenderState: TextRenderState) => {
    appliedRenderState = nextRenderState
    pendingRenderState = null
  }

  const stopAnimation = () => {
    if (frameId != null) {
      cancelAnimationFrame(frameId)
      frameId = null
    }
  }

  $effect(() => {
    const nextBlockId = block.id

    if (nextBlockId === activeBlockId) {
      return
    }

    activeBlockId = nextBlockId
    stopAnimation()
    nextTickAt = 0
    completeFired = false
    pendingRenderState = null
    appliedRenderState = block.renderState
    displayedLength = shouldTypewrite ? 0 : block.content.length
  })

  $effect(() => {
    const nextRenderState = block.renderState

    if (block.id !== activeBlockId || appliedRenderState === nextRenderState) {
      return
    }

    if (!hasRangeSelectionWithin(liveTailElement)) {
      applyRenderState(nextRenderState)
      return
    }

    pendingRenderState = nextRenderState
  })

  const flushPendingRenderState = () => {
    if (!pendingRenderState || hasRangeSelectionWithin(liveTailElement)) {
      return
    }

    applyRenderState(pendingRenderState)
  }

  onMount(() => {
    const handleVisibilityChange = () => {
      pageVisible = document.visibilityState === 'visible'
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('selectionchange', flushPendingRenderState)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('selectionchange', flushPendingRenderState)
    }
  })

  $effect(() => {
    if (isRevealed && !block.streaming && !completeFired && shouldTypewrite) {
      completeFired = true
      oncomplete?.()
    }
  })

  $effect(() => {
    if (!shouldTypewrite) {
      displayedLength = block.content.length
      return
    }

    if (displayedLength > block.content.length) {
      displayedLength = block.content.length
    }
  })

  $effect(() => {
    if (!shouldAnimate) {
      stopAnimation()
      if (!shouldTypewrite) {
        displayedLength = block.content.length
      }
      return () => stopAnimation()
    }

    if (frameId != null) {
      return () => stopAnimation()
    }

    const animate = (timestamp: number) => {
      const targetLength = block.content.length

      if (displayedLength >= targetLength) {
        frameId = null
        return
      }

      if (nextTickAt === 0 || timestamp >= nextTickAt) {
        const { burst, interval } = typewriter.config
        displayedLength = Math.min(targetLength, displayedLength + burst)
        nextTickAt = timestamp + interval
      }

      frameId = requestAnimationFrame(animate)
    }

    frameId = requestAnimationFrame(animate)

    return () => {
      nextTickAt = 0
      stopAnimation()
    }
  })

  const visibleRenderState = $derived.by(() => {
    let remaining = visibleCharacterCount
    const committedSegments: MarkdownSegment[] = []
    let partialMarkdownSource = ''

    for (const segment of appliedRenderState.committedSegments) {
      if (remaining >= segment.source.length) {
        committedSegments.push(segment)
        remaining -= segment.source.length
        continue
      }

      if (remaining > 0) {
        partialMarkdownSource = segment.source.slice(0, remaining)
      }

      remaining = 0
      break
    }

    const visibleLiveTail =
      remaining > 0
        ? appliedRenderState.liveTail.slice(0, remaining)
        : ''

    return {
      committedSegments,
      partialMarkdownSource,
      visibleLiveTail,
    }
  })

  const partialMarkdown = $derived(
    visibleRenderState.partialMarkdownSource
      ? repairIncompleteMarkdown(visibleRenderState.partialMarkdownSource)
      : ''
  )

  const showLiveTailCaret = $derived(
    shouldAnimate && !visibleRenderState.partialMarkdownSource
  )
</script>

<div class="relative" aria-live={messageStatus === 'streaming' ? 'polite' : 'off'}>
  {#each visibleRenderState.committedSegments as segment (segment.id)}
    <MarkdownHtml
      appendCaret={false}
      highlight={true}
      source={segment.source}
    />
  {/each}

  {#if partialMarkdown}
    <MarkdownHtml
      appendCaret={shouldAnimate}
      highlight={true}
      source={partialMarkdown}
    />
  {/if}

  {#if visibleRenderState.visibleLiveTail || showLiveTailCaret}
    <div bind:this={liveTailElement}>
      {#if visibleRenderState.visibleLiveTail}
        <MarkdownHtml
          appendCaret={showLiveTailCaret}
          highlight={true}
          source={repairIncompleteMarkdown(visibleRenderState.visibleLiveTail)}
        />
      {/if}
      {#if showLiveTailCaret && !visibleRenderState.visibleLiveTail}
        <span class="caret-blink" aria-hidden="true"></span>
      {/if}
    </div>
  {/if}
</div>

