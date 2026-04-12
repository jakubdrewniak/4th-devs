<script lang="ts">
import type { Snippet } from 'svelte'
import { slide } from 'svelte/transition'

interface Props {
  title?: string
  description?: string
  collapsible?: boolean
  defaultOpen?: boolean
  children: Snippet
  actions?: Snippet
}

let { title, description, collapsible = false, defaultOpen = true, children, actions }: Props = $props()
let isOpen = $state(defaultOpen)
</script>

<div class="rounded-lg border border-border bg-surface-1/70 px-4 py-4">
  {#if title || description || actions}
    <div class="mb-3 flex items-start justify-between gap-3">
      {#if collapsible}
        <button type="button" class="flex flex-1 items-start justify-between gap-3 text-left" onclick={() => { isOpen = !isOpen }}>
          <div>
            {#if title}
              <p class="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{title}</p>
            {/if}
            {#if description}
              <p class="mt-1 text-[12px] text-text-secondary">{description}</p>
            {/if}
          </div>
          <svg class="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform {isOpen ? 'rotate-180' : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
      {:else}
        <div>
          {#if title}
            <p class="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{title}</p>
          {/if}
          {#if description}
            <p class="mt-1 text-[12px] text-text-secondary">{description}</p>
          {/if}
        </div>
      {/if}
      {#if actions}
        {@render actions()}
      {/if}
    </div>
  {/if}
  {#if collapsible}
    {#if isOpen}
      <div transition:slide={{ duration: 150 }}>
        {@render children()}
      </div>
    {/if}
  {:else}
    {@render children()}
  {/if}
</div>
