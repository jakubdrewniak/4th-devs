<script lang="ts">
  import type { ErrorBlock as ErrorBlockModel } from '../../../shared/chat'

  let { block }: { block: ErrorBlockModel } = $props()
</script>

<div class="rounded-lg bg-surface-1 overflow-hidden border-l-2 border-l-danger/40">
  <div class="flex items-start gap-2.5 px-3.5 py-2.5">
    <div class="w-6 h-6 rounded-md bg-surface-2 flex items-center justify-center shrink-0 mt-0.5">
      <svg class="w-3.5 h-3.5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    </div>
    <span class="text-[13px] font-medium text-danger-text/90 leading-relaxed">{block.message}</span>
  </div>
</div>
