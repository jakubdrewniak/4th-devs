<script lang="ts">
interface Props {
  checked: boolean
  label: string
  hint?: string | null
  disabled?: boolean
  onchange?: (checked: boolean) => void
}

let { checked, label, hint = null, disabled = false, onchange }: Props = $props()
</script>

<button
  type="button"
  class="flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors {checked ? 'border-accent/30 bg-accent/10 text-text-primary' : 'border-border bg-surface-0 text-text-secondary hover:text-text-primary'}"
  {disabled}
  onclick={() => onchange?.(!checked)}
>
  <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {checked ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent'}">
    <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="2.5 6 5 8.5 9.5 3.5" />
    </svg>
  </span>
  <span>{label}</span>
  {#if hint}
    <span class="text-[11px] text-text-tertiary">({hint})</span>
  {/if}
</button>
