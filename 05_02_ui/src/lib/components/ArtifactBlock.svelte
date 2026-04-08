<script lang="ts">
  import type { ArtifactBlock as ArtifactBlockModel } from '../../../shared/chat'
  import MarkdownHtml from './MarkdownHtml.svelte'

  let { block }: { block: ArtifactBlockModel } = $props()

  let previewOpen = $state(true)

  const artifactHref = (path: string | undefined): string =>
    path ? `/api/artifacts/${encodeURIComponent(path)}` : '#'

  const previewSource = $derived(
    block.kind === 'json'
      ? `\`\`\`json\n${block.preview}\n\`\`\``
      : block.preview
  )
</script>

<div class="rounded-lg bg-surface-1 overflow-hidden border-l-2 border-l-artifact/40">
  <button
    type="button"
    class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.015] transition-colors"
    onclick={() => { previewOpen = !previewOpen }}
  >
    <div class="w-6 h-6 rounded-md bg-surface-2 flex items-center justify-center shrink-0">
      <svg class="w-3.5 h-3.5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>
    </div>

    <div class="flex-1 min-w-0">
      <span class="text-[13px] font-medium text-text-primary truncate block">{block.title}</span>
      {#if block.description}
        <span class="text-[12px] text-text-tertiary truncate block mt-0.5">{block.description}</span>
      {/if}
    </div>

    <div class="flex items-center gap-2.5 shrink-0">
      {#if block.path}
        <a
          class="text-[12px] text-artifact-text/80 hover:text-artifact-text transition-colors"
          href={artifactHref(block.path)}
          target="_blank"
          rel="noreferrer"
          onclick={(e) => e.stopPropagation()}
        >
          Open
        </a>
      {/if}

      <svg
        class="w-4 h-4 text-text-tertiary shrink-0 transition-transform duration-150 {previewOpen ? 'rotate-180' : ''}"
        viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M4 6l4 4 4-4"/>
      </svg>
    </div>
  </button>

  <div class="collapsible {previewOpen ? 'open' : ''}">
    <div>
      <div class="border-t border-border mx-3.5"></div>
      <div class="px-3.5 py-3">
        {#if previewOpen}
          <MarkdownHtml
            className="text-[13px] text-text-secondary leading-relaxed"
            highlight={true}
            source={previewSource}
          />
        {/if}
      </div>
    </div>
  </div>
</div>
