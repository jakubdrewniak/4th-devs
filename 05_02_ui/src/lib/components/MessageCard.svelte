<script lang="ts">
  import BlockRenderer from './BlockRenderer.svelte'
  import type { UiMessage } from '../stores/chat-store.svelte'

  let { message, isLatest = false }: { message: UiMessage; isLatest?: boolean } = $props()

  const formatTime = (value: string): string =>
    new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

{#if message.role === 'user'}
  <div class="py-5">
    <div class="max-w-[85%] ml-auto">
      <div class="flex items-center justify-end gap-2 mb-1">
        <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
      </div>
      <div class="rounded-lg rounded-tr-sm bg-surface-2 px-4 py-3">
        <p class="text-text-primary whitespace-pre-wrap text-[0.9375rem] leading-relaxed m-0">{message.text}</p>
      </div>
    </div>
  </div>
{:else}
  <div class="py-5">
    <div class="flex items-start gap-3">
      <div class="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-accent-soft flex items-center justify-center">
        <svg class="w-3 h-3 text-accent-text" viewBox="0 0 16 16" fill="none">
          <path d="M8 2l1.5 3.5L13 7l-3.5 1.5L8 12l-1.5-3.5L3 7l3.5-1.5L8 2z" fill="currentColor" opacity="0.9"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[12px] font-medium text-text-secondary">Assistant</span>
          <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
          {#if message.status === 'error'}
            <span class="flex items-center gap-1.5 text-[11px] text-danger-text">
              <span class="w-1 h-1 rounded-full bg-danger"></span>
              failed
            </span>
          {/if}
        </div>
        <BlockRenderer
          blocks={message.blocks}
          {isLatest}
          messageStatus={message.status}
        />
      </div>
    </div>
  </div>
{/if}
