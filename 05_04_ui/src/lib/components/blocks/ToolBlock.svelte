<script lang="ts">
import { onMount } from 'svelte'
import type { ToolInteractionBlock } from '../../../../shared/chat'
import {
  getBlockAnnouncement,
  focusAdjacentExpandableToggle,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'
import { formatStructuredValue } from '../../runtime/format'
import { escapeHtml, hljs } from '../../services/markdown/highlight'
import { getShortcutManagerContext } from '../../shortcuts/shortcut-manager'
import { chatStore } from '../../stores/chat-store.svelte'
import McpAppView from './McpAppView.svelte'
import { getSuspendedToolLabel, isSuspendedToolBlock } from './tool-state'

const MIN_HOLD_MS = 450
const STALE_THRESHOLD_MS = 2000

let { block }: { block: ToolInteractionBlock } = $props()
const mountedAt = Date.now()
const shortcutManager = getShortcutManagerContext()
const isApplePlatform =
  typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform)
const shortcutLabels = {
  acceptOnce: isApplePlatform ? 'Cmd+Enter' : 'Ctrl+Enter',
  reject: 'Esc',
  trust: isApplePlatform ? 'Cmd+Shift+Enter' : 'Ctrl+Shift+Enter',
}

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
let releasedCompletionKey = $state<string | null>(null)

const toggle = () => {
  userHasToggled = true
  expanded = !expanded
}

const hasAppView = $derived(Boolean(block.appsMeta?.resourceUri))
const argsText = $derived(block.args == null ? '{}' : formatStructuredValue(block.args))
const outputText = $derived(block.output == null ? '' : formatStructuredValue(block.output))

const highlightJson = (text: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return escapeHtml(text)
  }
}

const argsHtml = $derived(highlightJson(argsText))
const outputHtml = $derived(highlightJson(outputText))
const panelId = $derived(getExpandablePanelId(block))
const toggleLabel = $derived(getExpandableToggleLabel(block, expanded))
const announcement = $derived(getBlockAnnouncement(block))
const confirmationWaitId = $derived(block.confirmation?.waitId ?? null)
const confirmationOwnerRunId = $derived(
  block.confirmation?.ownerRunId ?? block.sourceRunId ?? null,
)
const showConfirmationPanel = $derived(
  block.status === 'awaiting_confirmation' && Boolean(block.confirmation),
)
const suspendedTool = $derived(isSuspendedToolBlock(block))
const suspendedToolLabel = $derived(suspendedTool ? getSuspendedToolLabel(block) : null)
const approvalBadgeLabel = $derived.by(() => {
  if (block.approval?.status === 'approved' && block.approval.remembered) {
    return 'Trusted'
  }

  return block.approval?.status === 'rejected' ? 'Rejected' : null
})
const activePendingConfirmation = $derived.by(() => {
  if (block.status !== 'awaiting_confirmation' || !confirmationWaitId) return false
  if (chatStore.resolvingWaitIds.has(confirmationWaitId)) return false
  const pending = chatStore.pendingToolConfirmation
  return Boolean((pending && pending.waitId === confirmationWaitId) || block.confirmation)
})

const thisWaitResolving = $derived(
  confirmationWaitId ? chatStore.resolvingWaitIds.has(confirmationWaitId) : false,
)

let resolvingAction = $state<'approve' | 'trust' | 'reject' | null>(null)
let resolveError = $state<string | null>(null)

const resolvingLabel = $derived.by(() => {
  switch (resolvingAction) {
    case 'approve': return 'Approving…'
    case 'trust': return 'Trusting…'
    case 'reject': return 'Rejecting…'
    default: return null
  }
})

const approveOnce = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'approve'
  await chatStore.approvePendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not approve. Try again.'
    resolvingAction = null
  }
}

const trustAndApprove = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'trust'
  await chatStore.trustPendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not trust and approve. Try again.'
    resolvingAction = null
  }
}

const rejectConfirmation = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'reject'
  await chatStore.rejectPendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not reject. Try again.'
    resolvingAction = null
  }
}

const headerRunning = $derived(
  !suspendedTool &&
  block.status !== 'error' &&
    block.status !== 'awaiting_confirmation' &&
    (block.status === 'running' || (block.status === 'complete' && holdRunningVisual)),
)

$effect(() => {
  if (block.status !== 'awaiting_confirmation') {
    resolvingAction = null
    resolveError = null
  }
})

const handleToggleKeydown = (event: KeyboardEvent) => {
  const currentTarget = event.currentTarget
  if (!(currentTarget instanceof HTMLButtonElement)) {
    return
  }

  if (focusAdjacentExpandableToggle(currentTarget, event.key)) {
    event.preventDefault()
  }
}

$effect(() => {
  if ((block.status === 'awaiting_confirmation' || hasAppView) && !userHasToggled) {
    requestAnimationFrame(() => { expanded = true })
  }
})

$effect.pre(() => {
  void block.toolCallId
  void block.status
  void block.createdAt
  void block.finishedAt

  if (block.status === 'error' || block.status === 'running' || block.status === 'awaiting_confirmation') {
    holdRunningVisual = false
    return
  }

  const ms = toolDurationMs(block)
  if (ms == null || ms >= MIN_HOLD_MS) {
    holdRunningVisual = false
    return
  }

  const finishedTs = block.finishedAt != null ? Date.parse(block.finishedAt) : null
  if (finishedTs != null && finishedTs < mountedAt - STALE_THRESHOLD_MS) {
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

  if (block.status === 'error' || block.status === 'running' || block.status === 'awaiting_confirmation') {
    return
  }

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

onMount(() =>
  shortcutManager.registerShortcuts([
    {
      allowInEditable: true,
      description: 'Accept tool confirmation once',
      id: `tool.accept-once:${block.toolCallId}`,
      keys: ['Mod+Enter'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        approveOnce()
      },
    },
    {
      allowInEditable: true,
      description: 'Accept and trust tool confirmation',
      id: `tool.accept-trust:${block.toolCallId}`,
      keys: ['Mod+Shift+Enter'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        trustAndApprove()
      },
    },
    {
      allowInEditable: true,
      description: 'Reject tool confirmation',
      id: `tool.reject:${block.toolCallId}`,
      keys: ['Escape'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        rejectConfirmation()
      },
    },
  ]))
</script>

<div>
  <button
    id={`${panelId}-toggle`}
    type="button"
    data-block-toggle="true"
    class="w-full flex items-center gap-2 py-1 text-left group text-text-secondary hover:text-text-primary transition-colors"
    onclick={toggle}
    onkeydown={handleToggleKeydown}
    aria-controls={panelId}
    aria-expanded={expanded}
    aria-label={toggleLabel}
  >
    {#if announcement}
      <span class="sr-only" aria-live={block.status === 'error' ? 'assertive' : 'polite'}>
        {announcement}
      </span>
    {/if}
    <div class="w-4 h-4 flex items-center justify-center shrink-0 {block.status === 'error' ? 'text-danger-text' : block.status === 'awaiting_confirmation' && !resolvingAction ? 'text-accent' : suspendedTool ? 'text-text-tertiary' : headerRunning || resolvingAction ? 'text-text-primary' : 'text-text-tertiary'}">
      {#if block.status === 'error'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {:else if block.status === 'awaiting_confirmation' && resolvingAction}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else if block.status === 'awaiting_confirmation'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18h.01"/><path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4"/></svg>
      {:else if suspendedTool}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
        </svg>
      {:else if headerRunning}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>

    <div class="flex-1 min-w-0 flex items-center gap-2">
      <span class="text-[13px] truncate text-text-secondary group-hover:text-text-primary transition-colors">{block.name}</span>
      {#if block.status === 'error' && block.approval?.status !== 'rejected'}
        <span class="text-[11px] text-danger-text whitespace-nowrap">Failed</span>
      {:else if block.status === 'awaiting_confirmation' && resolvingAction}
        <span class="text-[11px] text-text-tertiary whitespace-nowrap">{resolvingLabel}</span>
      {:else if block.status === 'awaiting_confirmation'}
        <span class="text-[11px] text-accent whitespace-nowrap">Needs approval</span>
      {:else if suspendedTool && suspendedToolLabel}
        <span class="text-[11px] text-text-tertiary whitespace-nowrap">{suspendedToolLabel}</span>
      {/if}
      {#if approvalBadgeLabel}
        <span
          class="text-[11px] whitespace-nowrap {block.approval?.status === 'rejected' ? 'text-danger-text' : 'text-accent'}"
        >
          {approvalBadgeLabel}
        </span>
      {/if}
    </div>

    <svg
      class="w-3.5 h-3.5 shrink-0 transition-all duration-150 opacity-0 group-hover:opacity-100 {expanded ? 'rotate-180 opacity-50' : ''}"
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

  <div
    id={panelId}
    class="collapsible {expanded ? 'open' : ''}"
    role="region"
    aria-busy={headerRunning || resolvingAction === 'approve' || resolvingAction === 'trust' || undefined}
    aria-labelledby={`${panelId}-toggle`}
  >
    <div>
      <div class="pl-6 pr-4 pb-2 space-y-3">
        <div>
          <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Input</div>
          <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{@html argsHtml}</pre>
        </div>

        {#if showConfirmationPanel && !thisWaitResolving}
          <div class="approval-breathe">
          {#if resolveError}
            <p class="text-[12px] text-danger-text">{resolveError}</p>
          {/if}

            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                class="confirm-trust inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/12 px-2.5 py-1 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/20 hover:border-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
                onclick={trustAndApprove}
                disabled={thisWaitResolving}
                aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
              >
                <span>Accept &amp; trust</span>
                <span class="text-[10px] opacity-55">{shortcutLabels.trust}</span>
              </button>

              <button
                type="button"
                class="confirm-once inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
                onclick={approveOnce}
                disabled={thisWaitResolving}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                <span>Accept once</span>
                <span class="text-[10px] opacity-55">{shortcutLabels.acceptOnce}</span>
              </button>

              <button
                type="button"
                class="confirm-reject inline-flex items-center gap-1.5 rounded-md border border-danger/15 bg-transparent px-2.5 py-1 text-[12px] font-medium text-text-tertiary transition-colors hover:text-danger-text hover:border-danger/35 hover:bg-danger/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
                onclick={rejectConfirmation}
                disabled={thisWaitResolving}
                aria-keyshortcuts="Escape"
              >
                <span>Reject</span>
                <span class="text-[10px] opacity-55">{shortcutLabels.reject}</span>
              </button>
            </div>
          </div>
        {/if}
        {#if hasAppView}
          <div>
            <McpAppView {block} />
          </div>
        {:else if outputText || block.status === 'running'}
          <div>
            <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Output</div>
            {#if outputText}
              <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto overscroll-contain" style="scrollbar-width: thin;">{@html outputHtml}</pre>
            {:else if suspendedTool && suspendedToolLabel}
              <div class="flex items-center gap-2 py-1 text-[12px] text-text-tertiary" aria-label={suspendedToolLabel} aria-live="polite" role="status">
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
                  <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
                </svg>
                <span>{suspendedToolLabel}</span>
              </div>
            {:else}
              <div class="flex items-center py-1" aria-label="Waiting for tool output" aria-live="polite" role="status">
                <span class="caret-blink shrink-0" aria-hidden="true"></span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
