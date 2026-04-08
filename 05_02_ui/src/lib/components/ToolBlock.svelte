<script lang="ts">
  import type { ToolInteractionBlock } from '../../../shared/chat'
  import { formatStructuredValue } from '../runtime/format'

  /** Minimum time the header stays in the running visual after a fast complete (createdAt → finishedAt). */
  const MIN_HOLD_MS = 450

  let { block }: { block: ToolInteractionBlock } = $props()

  let userHasToggled = false
  let expanded = $state(false)

  const toolDurationMs = (b: ToolInteractionBlock): number | null => {
    if (b.status !== 'complete') return null
    const created = Date.parse(b.createdAt)
    const finished = b.finishedAt != null ? Date.parse(b.finishedAt) : created
    if (!Number.isFinite(created) || !Number.isFinite(finished)) return null
    return Math.max(0, finished - created)
  }

  const completionKey = (b: ToolInteractionBlock): string => `${b.toolCallId}:${b.finishedAt ?? ''}`

  let holdRunningVisual = $state(false)
  /** After the extended hold elapses, we remember the completion so re-rendos do not re-arm the hold. */
  let releasedCompletionKey = $state<string | null>(null)

  const toggle = () => {
    userHasToggled = true
    expanded = !expanded
  }

  const argsText = $derived(formatStructuredValue(block.args))
  const outputText = $derived(block.output == null ? '' : formatStructuredValue(block.output))

  /** True while the real stream is running, or while we extend the running chrome after a fast complete. */
  const headerRunning = $derived(
    block.status !== 'error' &&
      (block.status === 'running' || (block.status === 'complete' && holdRunningVisual)),
  )

  const accentColor = $derived(
    block.status === 'error'
      ? 'var(--color-danger)'
      : headerRunning
        ? 'var(--color-accent)'
        : 'var(--color-success)',
  )

  $effect.pre(() => {
    void block.toolCallId
    void block.status
    void block.createdAt
    void block.finishedAt

    if (block.status === 'error') {
      holdRunningVisual = false
      return
    }

    if (block.status === 'running') {
      holdRunningVisual = false
      return
    }

    const ms = toolDurationMs(block)
    if (ms == null) {
      holdRunningVisual = false
      return
    }

    if (ms >= MIN_HOLD_MS) {
      holdRunningVisual = false
      return
    }

    const key = completionKey(block)
    if (releasedCompletionKey === key) {
      holdRunningVisual = false
      return
    }

    holdRunningVisual = true
  })

  $effect(() => {
    void block.toolCallId
    void block.status
    void block.createdAt
    void block.finishedAt

    if (block.status === 'error' || block.status === 'running') return

    const ms = toolDurationMs(block)
    if (ms == null || ms >= MIN_HOLD_MS) return

    const key = completionKey(block)
    if (releasedCompletionKey === key) return

    const extendMs = MIN_HOLD_MS - ms
    const id = setTimeout(() => {
      releasedCompletionKey = key
    }, extendMs)
    return () => clearTimeout(id)
  })
</script>

<div class="rounded-lg bg-surface-1 overflow-hidden border-l-2" style="border-left-color: color-mix(in srgb, {accentColor} 40%, transparent);">
  <button
    type="button"
    class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.015] transition-colors"
    onclick={toggle}
  >
    <div class="w-6 h-6 rounded-md bg-surface-2 flex items-center justify-center shrink-0">
      {#if block.status === 'error'}
        <svg class="w-3.5 h-3.5 text-danger-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      {:else if headerRunning}
        <span class="tool-spinner" aria-hidden="true"></span>
      {:else}
        <svg class="w-3.5 h-3.5 text-success-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-[13px] font-medium text-text-primary truncate">{block.name}</span>
        {#if block.status === 'error'}
          <span class="text-[11px] text-danger-text whitespace-nowrap">Failed</span>
        {/if}
      </div>
    </div>

    <svg
      class="w-4 h-4 text-text-tertiary shrink-0 transition-transform duration-150 {expanded ? 'rotate-180' : ''}"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  </button>

  <div class="collapsible {expanded ? 'open' : ''}">
    <div>
      <div class="border-t border-border mx-3.5"></div>
      <div class="px-3.5 py-3 space-y-3">
        <div>
          <div class="label mb-1">Input</div>
          <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{argsText}</pre>
        </div>
        {#if outputText || block.status === 'running'}
          <div class="border-t border-border -mx-3.5 px-3.5 pt-3">
            <div class="label mb-1">Output</div>
            {#if outputText}
              <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{outputText}</pre>
            {:else}
              <div class="flex items-center gap-2 py-1">
                <span class="tool-spinner shrink-0" aria-hidden="true"></span>
                <span class="text-[12px] text-text-tertiary">Waiting for response…</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .tool-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--color-surface-3);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    display: inline-block;
    box-sizing: border-box;
    animation: tool-spin 0.8s linear infinite;
  }

  @keyframes tool-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
