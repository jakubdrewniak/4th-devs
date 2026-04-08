<script lang="ts">
  import type { Block, MessageStatus } from '../../../shared/chat'
  import { typewriter } from '../stores/typewriter.svelte'
  import ArtifactBlock from './ArtifactBlock.svelte'
  import ErrorBlock from './ErrorBlock.svelte'
  import TextBlock from './TextBlock.svelte'
  import ThinkingBlock from './ThinkingBlock.svelte'
  import ToolBlock from './ToolBlock.svelte'

  interface Props {
    blocks?: Block[]
    isLatest?: boolean
    messageStatus?: MessageStatus
  }

  let { blocks = [], isLatest = false, messageStatus = 'complete' }: Props = $props()

  let messageWasStreaming = $state(false)
  let completedTextIds = $state(new Set<string>())
  let gateIndex = $state(0)

  $effect(() => {
    if (messageStatus === 'streaming') {
      messageWasStreaming = true
    }
  })

  const gatingActive = $derived(
    typewriter.enabled && isLatest && messageWasStreaming
  )

  const computeGate = (): number => {
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]
      if (b.type === 'text' && !completedTextIds.has(b.id)) {
        return i + 1
      }
    }
    return blocks.length
  }

  $effect(() => {
    if (!gatingActive) {
      gateIndex = blocks.length
      return
    }

    gateIndex = computeGate()
  })

  const markTextComplete = (id: string) => {
    completedTextIds = new Set([...completedTextIds, id])
  }

  const visibleBlocks = $derived(
    gatingActive ? blocks.slice(0, gateIndex) : blocks
  )

  let knownBlockIds = $state(new Set<string>())

  const isNew = (id: string): boolean => {
    if (knownBlockIds.has(id)) {
      return false
    }
    knownBlockIds.add(id)
    return true
  }

  // Trailing thinking indicator: shown when the message is streaming but the
  // last visible block is NOT actively producing content. This bridges the gap
  // between finished text → incoming tool call, or tool result → next text, etc.
  const showTrailingActivity = $derived.by(() => {
    if (messageStatus !== 'streaming') return false
    if (visibleBlocks.length === 0) return false
    if (gatingActive && gateIndex < blocks.length) return false

    const last = visibleBlocks[visibleBlocks.length - 1]

    if (last.type === 'text') return false
    if (last.type === 'thinking' && last.status === 'thinking') return false
    if (last.type === 'tool_interaction' && last.status === 'running') return false

    return true
  })
</script>

{#if blocks.length === 0 && messageStatus === 'streaming'}
  <div class="flex items-center gap-2.5 py-2 text-text-tertiary text-[13px]">
    <span class="caret-blink"></span>
    <span>Waiting for response…</span>
  </div>
{:else}
  <div class="space-y-3">
    {#each visibleBlocks as block, index (block.id)}
      {@const entering = isNew(block.id)}
      <div style={entering ? 'animation: fade-up 180ms ease both;' : ''}>
        {#if block.type === 'text'}
          <TextBlock
            {block}
            {isLatest}
            {messageStatus}
            shouldTypewrite={gatingActive}
            oncomplete={() => markTextComplete(block.id)}
          />
        {:else if block.type === 'thinking'}
          <ThinkingBlock {block} />
        {:else if block.type === 'tool_interaction'}
          <ToolBlock {block} />
        {:else if block.type === 'artifact'}
          <ArtifactBlock {block} />
        {:else if block.type === 'error'}
          <ErrorBlock {block} />
        {/if}
      </div>
    {/each}

    {#if showTrailingActivity}
      <div
        class="flex items-center gap-2.5 py-1.5 text-text-tertiary text-[13px]"
        style="animation: fade-up 180ms ease both;"
      >
        <span class="caret-blink"></span>
        <span>Thinking…</span>
      </div>
    {/if}
  </div>
{/if}
