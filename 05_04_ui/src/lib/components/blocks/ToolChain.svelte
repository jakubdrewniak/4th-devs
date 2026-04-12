<script lang="ts">
import type { ToolInteractionBlock } from '../../../../shared/chat'
import { formatStructuredValue } from '../../runtime/format'
import { escapeHtml, hljs } from '../../services/markdown/highlight'

let { blocks }: { blocks: ToolInteractionBlock[] } = $props()

let expanded = $state(false)
let expandedToolId = $state<string | null>(null)

const totalDuration = $derived.by(() => {
  let earliest = Infinity
  let latest = 0
  for (const b of blocks) {
    const created = Date.parse(b.createdAt)
    const finished = b.finishedAt != null ? Date.parse(b.finishedAt) : created
    if (Number.isFinite(created) && created < earliest) earliest = created
    if (Number.isFinite(finished) && finished > latest) latest = finished
  }
  if (!Number.isFinite(earliest) || latest <= earliest) return null
  const ms = latest - earliest
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

const chainSegments = $derived.by(() => {
  const segs: { name: string; count: number }[] = []
  for (const b of blocks) {
    const last = segs[segs.length - 1]
    if (last && last.name === b.name) {
      last.count++
    } else {
      segs.push({ name: b.name, count: 1 })
    }
  }
  return segs
})

const toolHint = (block: ToolInteractionBlock): string | null => {
  if (block.args == null) return null
  const vals = Object.values(block.args)
  const first = vals.find((v): v is string => typeof v === 'string')
  if (first) return first.length > 60 ? first.slice(0, 57) + '\u2026' : first
  if (vals.length > 0) return `${vals.length} params`
  return null
}

const highlightJson = (text: string): string => {
  if (!text) return ''
  try { return hljs.highlight(text, { language: 'json' }).value }
  catch { return escapeHtml(text) }
}

const toggleTool = (id: string) => {
  expandedToolId = expandedToolId === id ? null : id
}
</script>

<div class="tool-chain-accent">
  <button
    type="button"
    class="tool-chain-header"
    onclick={() => { expanded = !expanded }}
  >
    <div class="tool-chain-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <div class="tool-chain-segments">
      {#each chainSegments as seg, i}
        {#if i > 0}<span class="tool-chain-sep">&rarr;</span>{/if}
        <span class="tool-chain-item">{seg.name}{#if seg.count > 1}<span class="tool-chain-mult">&times;{seg.count}</span>{/if}</span>
      {/each}
    </div>
    {#if totalDuration}
      <span class="tool-chain-time">{totalDuration}</span>
    {/if}
    <div class="tool-chain-chevron" class:open={expanded}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
    </div>
  </button>

  <div class="collapsible" class:open={expanded}>
    <div>
      <div class="tool-chain-list">
        {#each blocks as block (block.id)}
          <button
            type="button"
            class="tool-chain-row"
            onclick={() => toggleTool(block.id)}
          >
            <div class="tool-chain-row-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <span class="tool-chain-row-name">{block.name}</span>
            {#if toolHint(block)}
              <span class="tool-chain-row-hint">{toolHint(block)}</span>
            {/if}
          </button>
          <div class="collapsible" class:open={expandedToolId === block.id}>
            <div>
              <div class="tool-chain-detail">
                {#if block.args != null}
                  <div>
                    <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Input</div>
                    <pre class="m-0 text-[11px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[8lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{@html highlightJson(formatStructuredValue(block.args))}</pre>
                  </div>
                {/if}
                {#if block.output != null}
                  <div>
                    <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Output</div>
                    <pre class="m-0 text-[11px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[8lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{@html highlightJson(formatStructuredValue(block.output))}</pre>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
