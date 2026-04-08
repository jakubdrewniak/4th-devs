<script lang="ts">
  import type { ThinkingBlock as ThinkingBlockModel } from '../../../shared/chat'
  import { prepareMarkdownForRender } from '../runtime/incomplete-markdown'
  import MarkdownHtml from './MarkdownHtml.svelte'

  let { block }: { block: ThinkingBlockModel } = $props()

  let expanded = $state(false)

  const isActive = $derived(block.status === 'thinking')
  const markdownSource = $derived(
    prepareMarkdownForRender(
      block.content || '_Waiting for reasoning output…_',
      block.status === 'thinking',
    )
  )
</script>

<div class="rounded-lg bg-surface-1 overflow-hidden border-l-2 border-l-accent/40">
  <button
    type="button"
    class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.015] transition-colors"
    onclick={() => { expanded = !expanded }}
  >
    <div class="w-6 h-6 rounded-md bg-surface-2 flex items-center justify-center shrink-0">
      {#if isActive}
        <span class="caret-blink" style="width:2px;height:14px;"></span>
      {:else}
        <svg class="w-3.5 h-3.5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>

    <span class="flex-1 min-w-0 text-[13px] font-medium text-text-primary truncate">{block.title}</span>

    {#if isActive}
      <span class="text-[11px] text-accent-text mr-1">thinking…</span>
    {/if}

    <svg
      class="w-4 h-4 text-text-tertiary shrink-0 transition-transform duration-150 {expanded || isActive ? 'rotate-180' : ''}"
      viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    >
      <path d="M4 6l4 4 4-4"/>
    </svg>
  </button>

  <div class="collapsible {expanded || isActive ? 'open' : ''}">
    <div>
      <div class="border-t border-border mx-3.5"></div>
      <div class="px-3.5 py-3">
        {#if expanded || isActive}
          <MarkdownHtml
            className="text-[13px] text-text-secondary leading-relaxed"
            highlight={block.status !== 'thinking'}
            source={markdownSource}
          />
        {/if}
      </div>
    </div>
  </div>
</div>
