<script lang="ts">
import type { Block, MessageFinishReason, MessageStatus } from '../../../../shared/chat'
import { untrack } from 'svelte'
import { quintOut } from 'svelte/easing'
import { typewriterPlayback } from '../../stores/typewriter-playback.svelte'
import { typewriter } from '../../stores/typewriter.svelte'
import DelegationBlock from './DelegationBlock.svelte'
import { buildVisibleBlocks } from './block-visibility'
import { buildBlockRenderItems } from './render-items'
import { shouldEnableTypewriterGate } from './typewriter-gating'
import SafeBlock from './SafeBlock.svelte'
import ToolChain from './ToolChain.svelte'
import { logChatDebug } from '../../runtime/chat-debug'

interface Props {
  blocks?: Block[]
  messageFinishReason?: MessageFinishReason | null
  isLatest?: boolean
  messageUiKey?: string
  messageStatus?: MessageStatus
}

let {
  blocks = [],
  messageFinishReason = null,
  isLatest = false,
  messageUiKey = '',
  messageStatus = 'complete',
}: Props = $props()

let completedTextIds = $state(new Set<string>())
let previousDebugSignature = $state('')
let renderedBlocks = $state.raw<Block[]>([])
let bufferedBlocks = $state.raw<Block[] | null>(null)

/** Latches true once `messageStatus` is `streaming` for this visual message row. */
const streamSeen = { current: false }
const messageWasStreaming = $derived.by(() => {
  if (messageStatus === 'streaming') {
    streamSeen.current = true
  }
  return streamSeen.current
})

/** IDs of blocks that are children of a delegation (rendered inside DelegationBlock, not top-level). */
const delegationChildIds = $derived.by(() => {
  const childRunToParent = new Map<string, string>()
  for (const block of renderedBlocks) {
    if (block.type === 'tool_interaction' && block.name === 'delegate_to_agent' && block.childRunId) {
      childRunToParent.set(block.childRunId, block.id)
    }
  }
  if (childRunToParent.size === 0) return new Set<string>()
  const ids = new Set<string>()
  for (const block of renderedBlocks) {
    const src = 'sourceRunId' in block ? (block as { sourceRunId?: string }).sourceRunId : undefined
    if (src && childRunToParent.has(src) && block.id !== childRunToParent.get(src)) {
      ids.add(block.id)
    }
  }
  return ids
})

const hasRenderableTextBlocks = $derived(
  renderedBlocks.some((block) => block.type === 'text' && !delegationChildIds.has(block.id)),
)

const hasStreamingTextBlocks = $derived(
  renderedBlocks.some(
    (block) =>
      block.type === 'text' &&
      block.streaming &&
      !delegationChildIds.has(block.id),
  ),
)

$effect(() => {
  if (!messageUiKey || !hasStreamingTextBlocks) {
    return
  }

  typewriterPlayback.markStreamed(messageUiKey)
})

const hasPendingPlaybackForMessage = $derived(
  !!messageUiKey && typewriterPlayback.hasPendingKey(messageUiKey),
)

$effect(() => {
  const hasIncomingReplacement = renderedBlocks !== blocks

  if (messageStatus !== 'streaming' && hasPendingPlaybackForMessage && hasIncomingReplacement) {
    bufferedBlocks = blocks
    return
  }

  const nextBlocks = bufferedBlocks ?? blocks
  if (renderedBlocks !== nextBlocks) {
    renderedBlocks = nextBlocks
  }

  if (!hasPendingPlaybackForMessage) {
    bufferedBlocks = null
  }
})

const isDurableTextHandoffReplay = $derived(
  !!messageUiKey &&
  messageStatus !== 'streaming' &&
  hasRenderableTextBlocks &&
  !hasStreamingTextBlocks &&
  !hasPendingPlaybackForMessage &&
  typewriterPlayback.hasStreamed(messageUiKey),
)

const gatingActive = $derived(
  shouldEnableTypewriterGate({
    enabled: typewriter.enabled,
    finishReason: messageFinishReason,
    isDurableTextHandoffReplay,
    isLatest,
    messageWasStreaming,
  }),
)

const markTextComplete = (id: string) => {
  completedTextIds = new Set([...completedTextIds, id])
}

const hasPendingTypewriter = $derived(
  gatingActive &&
    renderedBlocks.some(
      (block) =>
        block.type === 'text' &&
        !completedTextIds.has(block.id) &&
        !delegationChildIds.has(block.id),
    ),
)

$effect(() => {
  const key = messageUiKey
  const pending = hasPendingTypewriter
  if (!key) {
    return
  }

  untrack(() => typewriterPlayback.setPending(key, pending))

  return () => {
    untrack(() => typewriterPlayback.clear(key))
  }
})

const hasDeferredTextBlocks = $derived.by(() => {
  let revealedActiveTextBlock = false

  for (const block of renderedBlocks) {
    if (block.type !== 'text' || delegationChildIds.has(block.id) || completedTextIds.has(block.id)) {
      continue
    }

    if (!revealedActiveTextBlock) {
      revealedActiveTextBlock = true
      continue
    }

    return true
  }

  return false
})

const visibleBlocks = $derived.by(() =>
  buildVisibleBlocks(renderedBlocks, {
    completedTextIds,
    delegationChildIds,
    gatingActive,
  }),
)
const hasDelegations = $derived(
  visibleBlocks.some(
    (block) => block.type === 'tool_interaction' && block.name === 'delegate_to_agent' && block.childRunId,
  ),
)

/** Groups blocks into delegations, chains, and individual blocks. */
const renderItems = $derived.by(() => buildBlockRenderItems(visibleBlocks, messageStatus))

/** Matches `fade-up` in app.css — runs on intro only for keyed {#each} rows.
 *  Skipped when the message is no longer streaming to avoid a flash when
 *  `refreshThreadMessages` replaces the message array with new objects. */
function fadeUp(_node: Element, { duration = 180 } = {}) {
  if (messageStatus !== 'streaming') {
    return { duration: 0, css: () => '' }
  }
  return {
    duration,
    easing: quintOut,
    css: (t: number, u: number) => `opacity: ${t}; transform: translateY(${u * 4}px);`,
  }
}

// Trailing thinking indicator: shown when the message is streaming but the
// last visible block is NOT actively producing content. This bridges the gap
// between finished text → incoming tool call, or tool result → next text, etc.
const showTrailingActivity = $derived.by(() => {
  if (messageStatus !== 'streaming') return false
  if (visibleBlocks.length === 0) return false
  if (hasDeferredTextBlocks) return false

  const last = visibleBlocks[visibleBlocks.length - 1]

  if (last.type === 'text') return false
  if (last.type === 'thinking' && last.status === 'thinking') return false
  if (last.type === 'tool_interaction' && (last.status === 'running' || last.status === 'awaiting_confirmation')) {
    return false
  }
  if (
    last.type === 'web_search' &&
    (last.status === 'in_progress' || last.status === 'searching')
  ) {
    return false
  }

  if (hasDelegations) {
    const hasActiveChild = visibleBlocks.some(
      (b) =>
        b.type === 'tool_interaction' &&
        (b.status === 'running' || b.status === 'awaiting_confirmation'),
    )
    if (hasActiveChild) return false
  }

  return true
})

$effect(() => {
  const signature = [
    messageUiKey,
    messageStatus,
    isLatest ? '1' : '0',
    messageWasStreaming ? '1' : '0',
    gatingActive ? '1' : '0',
    renderedBlocks.length,
  ].join(':')

  if (signature === previousDebugSignature) {
    return
  }

  previousDebugSignature = signature
  logChatDebug('block-renderer', 'state', {
    blockTypes: renderedBlocks.map((block) => block.type),
    bufferedBlockTypes: bufferedBlocks?.map((block) => block.type) ?? null,
    gatingActive,
    hasPendingPlaybackForMessage,
    isDurableTextHandoffReplay,
    isLatest,
    messageStatus,
    messageUiKey,
    messageWasStreaming,
    streamSeen: streamSeen.current,
    visibleBlockTypes: visibleBlocks.map((block) => block.type),
  })
})
</script>

{#if renderedBlocks.length === 0 && messageStatus === 'streaming'}
  <div
    class="flex items-center py-2 text-text-tertiary text-[13px]"
    aria-label="Waiting for response"
    aria-live="polite"
    role="status"
  >
    <span class="caret-blink"></span>
  </div>
{:else}
  <div class="flex flex-col">
    {#each renderItems as item (item.id)}
      {#if item.kind === 'chain'}
        <div in:fadeUp>
          <ToolChain blocks={item.blocks} />
        </div>
      {:else if item.kind === 'delegation'}
        <div in:fadeUp>
          <DelegationBlock parent={item.parent} children={item.children} {messageStatus} />
        </div>
      {:else}
        <div class={item.block.type === 'text' ? 'py-1.5' : ''} in:fadeUp>
          <SafeBlock
            block={item.block}
            {isLatest}
            {messageStatus}
            shouldTypewrite={gatingActive}
            oncomplete={() => markTextComplete(item.block.id)}
          />
        </div>
      {/if}
    {/each}

    {#if showTrailingActivity}
      <div
        class="flex items-center py-1.5 text-text-tertiary text-[13px]"
        aria-label="Waiting for response"
        aria-live="polite"
        role="status"
        style="animation: fade-up 180ms ease both;"
      >
        <span class="caret-blink"></span>
      </div>
    {/if}
  </div>
{/if}
