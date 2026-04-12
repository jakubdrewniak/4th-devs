<script lang="ts">
	import type { Block, ToolInteractionBlock, MessageStatus } from '../../../../shared/chat'
	import DelegationBlock from './DelegationBlock.svelte'
	import SafeBlock from './SafeBlock.svelte'
	import ToolChain from './ToolChain.svelte'
	import {
		getDelegationStatus,
		isReplyWaitBlock,
		type DelegationStatus,
	} from './delegation-state'
	import { buildBlockRenderItems } from './render-items'

	interface Props {
		parent: ToolInteractionBlock
		children: Block[]
		messageStatus?: MessageStatus
	}

let { parent, children, messageStatus = 'complete' }: Props = $props()

let expanded = $state<boolean | null>(null)

const hasAppViewChild = $derived(
  children.some(
    (child) =>
      child.type === 'tool_interaction' &&
      Boolean((child as ToolInteractionBlock).appsMeta?.resourceUri),
  ),
)

const agentAlias = $derived(
  typeof parent.args?.agentAlias === 'string' ? parent.args.agentAlias : 'agent',
)

const delegationStatus = $derived.by(
  (): DelegationStatus => getDelegationStatus(parent, children),
)

const waitingForReply = $derived(
  delegationStatus === 'suspended' &&
    (isReplyWaitBlock(parent) || children.some((child) => isReplyWaitBlock(child))),
)

const isOpen = $derived(
  expanded ??
    (delegationStatus === 'running' ||
      delegationStatus === 'awaiting' ||
      delegationStatus === 'suspended' ||
      hasAppViewChild),
)

	const toolCount = $derived(
		children.filter((child) => child.type === 'tool_interaction').length,
	)

const durationLabel = $derived.by((): string | null => {
  if (parent.status !== 'complete' || !parent.finishedAt) return null
  const start = Date.parse(parent.createdAt)
  const end = Date.parse(parent.finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const ms = Math.max(0, end - start)
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

const taskLabel = $derived(
  typeof parent.args?.task === 'string' && parent.args.task.length > 0
    ? parent.args.task.length > 60
      ? parent.args.task.slice(0, 57) + '…'
      : parent.args.task
    : null,
)

const metaLabel = $derived.by((): string => {
  const parts: string[] = []
  if (delegationStatus === 'running') parts.push('Running')
  else if (delegationStatus === 'awaiting') parts.push('Waiting')
  else if (delegationStatus === 'suspended') parts.push(waitingForReply ? 'Waiting for reply' : 'Suspended')
  else if (delegationStatus === 'completed') parts.push('Completed')
  else if (delegationStatus === 'failed') parts.push('Failed')

  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`)
  if (durationLabel) parts.push(durationLabel)
  return parts.join(' · ')
})

const accentClass = $derived.by((): string => {
  switch (delegationStatus) {
    case 'running':
      return 'deleg-running'
    case 'awaiting':
      return 'deleg-awaiting'
    case 'suspended':
      return 'deleg-suspended'
    case 'failed':
      return 'deleg-failed'
    default:
      return 'deleg-completed'
  }
})

	const resultSummary = $derived.by((): string | null => {
		if (!parent.output || typeof parent.output !== 'object' || Array.isArray(parent.output)) {
			return null
		}

		const candidate = parent.output as {
			error?: unknown
			kind?: unknown
			summary?: unknown
		}

		if (typeof candidate.summary === 'string' && candidate.summary.trim().length > 0) {
			return candidate.summary.trim()
		}

		if (candidate.kind === 'failed' && typeof candidate.error === 'string' && candidate.error.trim()) {
			return candidate.error.trim()
		}

		return null
	})

	const renderItems = $derived(buildBlockRenderItems(children, messageStatus))

	const toggle = () => {
		expanded = !isOpen
	}
</script>

<div class="deleg-accent {accentClass}">
  <button
    type="button"
    class="deleg-header"
    onclick={toggle}
  >
    <div class="deleg-icon {delegationStatus === 'failed' ? 'text-danger-text' : delegationStatus === 'running' || delegationStatus === 'awaiting' ? 'text-text-primary' : 'text-text-tertiary'}">
      {#if delegationStatus === 'failed'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {:else if delegationStatus === 'running' || delegationStatus === 'awaiting'}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else if delegationStatus === 'suspended'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
        </svg>
      {:else}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>
    <span class="deleg-name">{agentAlias}</span>
    {#if taskLabel && delegationStatus !== 'completed'}
      <span class="deleg-task">{taskLabel}</span>
    {/if}
    <span class="deleg-meta">{metaLabel}</span>
    {#if children.length > 0}
      <svg
        class="deleg-chevron {isOpen ? 'open' : ''}"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    {/if}
  </button>

	  {#if children.length > 0}
	    <div class="collapsible {isOpen ? 'open' : ''}">
	      <div>
	        <div class="deleg-children">
	          {#each renderItems as item (item.id)}
	            {#if item.kind === 'chain'}
	              <ToolChain blocks={item.blocks} />
	            {:else if item.kind === 'delegation'}
	              <DelegationBlock parent={item.parent} children={item.children} {messageStatus} />
	            {:else}
	              <SafeBlock block={item.block} messageStatus={messageStatus} />
	            {/if}
	          {/each}
	        </div>
	      </div>
	    </div>
	  {/if}

	  {#if resultSummary && isOpen}
	    <div class="deleg-summary">{resultSummary}</div>
	  {/if}
	</div>

<style>
  .deleg-accent {
    border-left: 2px solid var(--color-border-strong);
    padding-left: 12px;
    margin: 4px 0 4px 7px;
    transition: border-color 300ms;
  }

  .deleg-running {
    border-color: var(--color-accent);
  }

  .deleg-awaiting {
    border-color: var(--color-accent);
  }

  .deleg-suspended {
    border-color: var(--color-border-strong);
  }

  .deleg-completed {
    border-color: var(--color-text-tertiary);
    opacity: 0.75;
    transition: opacity 200ms, border-color 300ms;
  }

  .deleg-completed:hover {
    opacity: 1;
  }

  .deleg-failed {
    border-color: var(--color-danger-text);
  }

  .deleg-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: color 150ms;
  }

  .deleg-header:hover {
    color: var(--color-text-primary);
  }

  .deleg-header:hover .deleg-name {
    color: var(--color-text-primary);
  }

  .deleg-header:hover .deleg-chevron {
    opacity: 1;
  }

  .deleg-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .deleg-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-secondary);
    transition: color 150ms;
  }

  .deleg-task {
    font-size: 12px;
    color: var(--color-text-tertiary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deleg-meta {
    font-size: 11px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  .deleg-chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0;
    transition: all 150ms;
    margin-left: auto;
  }

  .deleg-chevron.open {
    opacity: 0.5;
    transform: rotate(180deg);
  }

	  .deleg-children {
	    padding: 0 0 4px 0;
	  }

	  .deleg-summary {
	    padding: 2px 0 0 24px;
	    color: var(--color-text-secondary);
	    font-size: 13px;
	    line-height: 1.55;
	    white-space: pre-wrap;
	  }
	</style>
