<script lang="ts">
type Status = 'ready' | 'degraded' | 'authorization_required' | 'assigned' | 'pending' | 'unknown' | string

interface Props {
  status: Status
  label?: string
}

let { status, label }: Props = $props()

const displayLabel = $derived(label ?? status)

const colorClass = $derived.by(() => {
  switch (status) {
    case 'ready':
    case 'assigned':
      return 'border-success/30 bg-success-soft text-success-text'
    case 'authorization_required':
    case 'add':
      return 'border-accent/30 bg-accent/10 text-accent'
    case 'degraded':
    case 'remove':
      return 'border-warning/30 bg-warning-soft text-warning-text'
    default:
      return 'border-border bg-surface-1 text-text-secondary'
  }
})
</script>

<span class="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] {colorClass}">
  {displayLabel}
</span>
