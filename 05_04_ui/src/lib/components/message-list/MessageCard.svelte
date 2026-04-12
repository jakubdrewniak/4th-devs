<script lang="ts">
import { onMount } from 'svelte'
import { filterInlineRenderedImageAttachments } from '../../attachments/model-visible'
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_IMAGE_MIN_WIDTH,
  getAttachmentImageGridMetrics,
  partitionAttachments,
  USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO,
} from '../../attachments/presentation'
import { imageAttachmentsToLightboxItems } from '../../lightbox/lightbox-adapters'
import { tryGetLightboxContext } from '../../lightbox/lightbox-context'
import {
  findTightBubbleWidth,
  prepareTextLayout,
  supportsTightUserBubble,
} from '../../runtime/message-height-estimator'
import { logChatDebug } from '../../runtime/chat-debug'
import { copyTextToClipboard } from '../../services/clipboard'
import type { UiMessage } from '../../stores/chat-store.svelte'
import { chatStore } from '../../stores/chat-store.svelte'
import { getMessageNavigatorContext } from '../../stores/message-navigator.svelte'
import { getWaitingFooterState } from '../blocks/delegation-state'
import BlockRenderer from '../blocks/BlockRenderer.svelte'
import FileChip from '../FileChip.svelte'
import ImageTile from '../ImageTile.svelte'
import MarkdownHtml from '../MarkdownHtml.svelte'

let { message, isLatest = false }: { message: UiMessage; isLatest?: boolean } = $props()
const lightbox = tryGetLightboxContext()
const messageNavigator = getMessageNavigatorContext()

const isHighlighted = $derived(messageNavigator.highlightedMessageId === message.id)
const showCopiedFeedback = $derived(messageNavigator.copiedMessageId === message.id)

let fontGeneration = $state(0)
let userMessageWidth = $state(0)
let isHovered = $state(false)
let hoverCopyLabel = $state('Copy')
let hoverCopyTimer: number | null = null
let previousDebugSignature = $state('')

const handleCopy = async () => {
  if (!hasText) return
  if (isHighlighted) {
    void messageNavigator.copyHighlighted(chatStore.messages)
    return
  }
  try {
    await copyTextToClipboard(message.text)
    hoverCopyLabel = 'Copied!'
  } catch {
    hoverCopyLabel = 'Failed'
  }
  if (hoverCopyTimer != null) window.clearTimeout(hoverCopyTimer)
  hoverCopyTimer = window.setTimeout(() => {
    hoverCopyLabel = 'Copy'
    hoverCopyTimer = null
  }, 1200)
}

const copyButtonLabel = $derived(
  isHighlighted ? (showCopiedFeedback ? 'Copied!' : 'Copy') : hoverCopyLabel,
)

const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const visibleAttachments = $derived(
  message.role === 'user'
    ? filterInlineRenderedImageAttachments(message.attachments, message.text)
    : message.attachments,
)
const attachmentGroups = $derived(partitionAttachments(visibleAttachments))
const imageAttachments = $derived(attachmentGroups.images)
const fileAttachments = $derived(attachmentGroups.files)
const hasText = $derived(message.text.trim().length > 0)
const canBranch = $derived(
  message.role === 'assistant' &&
    message.sequence !== null &&
    message.status === 'complete' &&
    !chatStore.isLoading &&
    !chatStore.isStreaming &&
    !chatStore.isCancelling &&
    !chatStore.isWaiting,
)
const canEdit = $derived(
  message.role === 'user' &&
    !chatStore.isLoading &&
    !chatStore.isStreaming &&
    !chatStore.isCancelling &&
    !chatStore.isWaiting,
)
const isEditing = $derived(chatStore.messageEditDraft?.messageId === message.id)
const hasUserActions = $derived(message.role === 'user' && (hasText || canEdit || isEditing))
const hasAssistantActions = $derived(message.role === 'assistant' && (hasText || canBranch))
const isStreamingThis = $derived(isLatest && chatStore.isStreaming && message.role === 'assistant')
const showActionBar = $derived(
  !isStreamingThis &&
    (isHighlighted || (isHovered && (message.role === 'assistant' ? hasAssistantActions : hasUserActions))),
)
const waitingFooterState = $derived.by(() =>
  message.finishReason === 'waiting' && message.status !== 'complete'
    ? getWaitingFooterState(message.blocks)
    : null,
)
/** `px-3` must stay aligned with USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING for estimator width. */
const bubblePaddingClass = 'px-3 py-2'
const singleImage = $derived(imageAttachments.length === 1 && fileAttachments.length === 0)

const preparedUserText = $derived.by(() => {
  fontGeneration // subscribe — recompute after font swap
  return message.role === 'user' &&
    visibleAttachments.length === 0 &&
    supportsTightUserBubble(message.text)
    ? prepareTextLayout(message.text || ' ', 15)
    : null
})

onMount(() => {
  logChatDebug('message-card', 'mount', {
    id: message.id,
    role: message.role,
    runId: message.runId,
    status: message.status,
    uiKey: message.uiKey ?? message.id,
  })
  void document.fonts.ready.then(() => {
    fontGeneration += 1
  })

  return () => {
    logChatDebug('message-card', 'destroy', {
      id: message.id,
      role: message.role,
      runId: message.runId,
      status: message.status,
      uiKey: message.uiKey ?? message.id,
    })
  }
})

$effect(() => {
  const signature = [
    message.id,
    message.uiKey ?? message.id,
    message.status,
    message.runId ?? '',
    message.blocks.length,
  ].join(':')

  if (signature === previousDebugSignature) {
    return
  }

  previousDebugSignature = signature
  logChatDebug('message-card', 'update', {
    blockTypes: message.blocks.map((block) => block.type),
    id: message.id,
    role: message.role,
    runId: message.runId,
    status: message.status,
    uiKey: message.uiKey ?? message.id,
  })
})

const openAttachmentLightbox = (attachmentId: string) => {
  if (!lightbox) {
    return
  }

  const items = imageAttachmentsToLightboxItems(imageAttachments)
  const index = imageAttachments.findIndex((attachment) => attachment.id === attachmentId)
  lightbox.openGallery(items, Math.max(0, index))
}

const tightBubbleWidth = $derived.by(() => {
  if (message.role !== 'user' || !preparedUserText || userMessageWidth <= 0) {
    return null
  }

  const maxOuterWidth = Math.max(
    1,
    Math.floor(userMessageWidth * USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO),
  )
  const maxContentWidth = Math.max(1, maxOuterWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING)
  const tightContentWidth = findTightBubbleWidth(preparedUserText, maxContentWidth)
  // Canvas measureText does not account for CSS letter-spacing (0.006em on .user-bubble-markdown).
  // Add a small buffer so the bubble never wraps text that the estimator thought would fit.
  const letterSpacingBuffer = Math.ceil(preparedUserText.text.length * 0.006 * preparedUserText.fontSize) + 1

  return Math.min(maxOuterWidth, tightContentWidth + letterSpacingBuffer + USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING)
})

const attachmentGridAvailableWidth = $derived.by(() => {
  if (message.role !== 'user' || imageAttachments.length === 0) {
    return 0
  }

  if (tightBubbleWidth != null) {
    return Math.max(
      ATTACHMENT_IMAGE_MIN_WIDTH,
      tightBubbleWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
    )
  }

  if (userMessageWidth <= 0) {
    return ATTACHMENT_IMAGE_MIN_WIDTH
  }

  const maxOuterWidth = Math.max(
    1,
    Math.floor(userMessageWidth * USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO),
  )
  return Math.max(
    ATTACHMENT_IMAGE_MIN_WIDTH,
    maxOuterWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  )
})

const attachmentGridMetrics = $derived(
  message.role === 'user' && imageAttachments.length > 0
    ? getAttachmentImageGridMetrics(imageAttachments.length, attachmentGridAvailableWidth)
    : null,
)
</script>

{#if message.role === 'user'}
  <div
    bind:clientWidth={userMessageWidth}
    class={`py-2.5 pr-3 rounded-lg transition-colors duration-150 ${isHighlighted ? 'msg-highlighted' : ''}`}
    role="article"
    aria-label={`User message at ${formatTime(message.createdAt)}`}
    data-message-id={message.id}
    onmouseenter={() => { isHovered = true }}
    onmouseleave={() => { isHovered = false }}
  >
    <div class="ml-auto flex max-w-[85%] flex-col items-end">
      <div class="mb-1 flex items-center gap-2">
        <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
      </div>

      {#if hasText || imageAttachments.length > 0 || fileAttachments.length > 0}
        <div
          data-lightbox-gallery
          class={`rounded-lg border border-user-bubble-border bg-user-bubble ${bubblePaddingClass}`}
          style:width={tightBubbleWidth ? `${tightBubbleWidth}px` : undefined}
        >
          {#if imageAttachments.length > 0 && attachmentGridMetrics}
            <div
              class={`flex flex-wrap ${hasText || fileAttachments.length > 0 ? 'mb-2.5' : ''} ${singleImage ? '' : 'justify-end'}`}
              style:gap="{ATTACHMENT_GRID_GAP}px"
              style:width="{attachmentGridMetrics.totalWidth}px"
            >
              {#each imageAttachments as attachment (attachment.id)}
                <ImageTile
                  alt={attachment.name}
                  src={attachment.thumbnailUrl ?? attachment.url}
                  href={attachment.url}
                  variant="message"
                  frameWidth={attachmentGridMetrics.tileWidth}
                  frameHeight={attachmentGridMetrics.tileHeight}
                  onOpenPreview={() => {
                    openAttachmentLightbox(attachment.id)
                  }}
                />
              {/each}
            </div>
          {/if}

          {#if hasText}
            <MarkdownHtml source={message.text} className="user-bubble-markdown" />
          {/if}

          {#if fileAttachments.length > 0}
            <div
              class={`flex flex-col items-end gap-2 ${hasText || imageAttachments.length > 0 ? 'mt-2.5' : ''}`}
            >
              {#each fileAttachments as attachment (attachment.id)}
                <FileChip attachment={attachment} href={attachment.url} variant="message" />
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if hasUserActions}
        <div class={`mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary transition-opacity duration-150 ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {#if isHighlighted}
            <span>
              <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">esc</kbd> dismiss
            </span>
          {/if}
          {#if hasText}
            <button
              type="button"
              class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary"
              onclick={() => { void handleCopy() }}
            >
              {copyButtonLabel}
              {#if isHighlighted}<kbd class="ml-1 rounded bg-surface-2 px-1 py-px text-[10px] text-text-tertiary">c</kbd>{/if}
            </button>
          {/if}
          <button
            type="button"
            class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
            disabled={!canEdit || isEditing}
            onclick={() => {
              chatStore.beginMessageEdit(message.id)
            }}
          >
            {isEditing ? 'Editing' : 'Edit'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div
    class={`py-2.5 px-3 rounded-lg transition-colors duration-150 ${isHighlighted ? 'msg-highlighted' : ''}`}
    role="article"
    aria-label={`Assistant message at ${formatTime(message.createdAt)}`}
    data-message-id={message.id}
    onmouseenter={() => { isHovered = true }}
    onmouseleave={() => { isHovered = false }}
  >
    <div class="flex items-center gap-2 mb-1.5">
      <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
      {#if message.status === 'error'}
        <span class="flex items-center gap-1.5 text-[11px] text-danger-text">
          <span class="w-1 h-1 rounded-full bg-danger"></span>
          failed
        </span>
      {:else if message.status === 'waiting'}
        <span class="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span class="w-1 h-1 rounded-full bg-border-strong"></span>
          waiting
        </span>
      {/if}
    </div>
    <div data-lightbox-gallery class="min-w-0">
      <BlockRenderer
        blocks={message.blocks}
        {isLatest}
        messageFinishReason={message.finishReason}
        messageUiKey={message.uiKey ?? message.id}
        messageStatus={message.status}
      />
    </div>
    {#if message.finishReason === 'cancelled'}
      <div class="mt-2.5 flex items-center gap-2 text-[12px] text-text-tertiary">
        <span class="h-px flex-1 max-w-8 bg-border"></span>
        <span>Request cancelled by user.</span>
      </div>
    {:else if message.finishReason === 'waiting'}
      <div class="mt-2.5 flex items-center gap-2 text-[12px] text-text-tertiary">
        <span class="h-px flex-1 max-w-8 bg-border"></span>
        {#if waitingFooterState?.kind === 'reply' || waitingFooterState?.kind === 'suspended'}
          <svg class="h-3.5 w-3.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
            <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          </svg>
        {:else}
          <span class="caret-blink shrink-0" aria-hidden="true"></span>
        {/if}
        <span>{waitingFooterState?.label}</span>
      </div>
    {/if}
    <div class={`mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary transition-opacity duration-150 ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
        disabled={!hasText}
        onclick={() => { void handleCopy() }}
      >
        {copyButtonLabel}
        {#if isHighlighted}<kbd class="ml-1 rounded bg-surface-2 px-1 py-px text-[10px] text-text-tertiary">c</kbd>{/if}
      </button>
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
        disabled={!canBranch}
        onclick={() => {
          void chatStore.branchFromMessage(message.id)
        }}
      >
        Branch
      </button>
      {#if isHighlighted}
        <span>
          <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">↑↓</kbd> navigate
        </span>
        <span>
          <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">esc</kbd> dismiss
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .msg-highlighted {
    background: color-mix(in srgb, var(--theme-accent, #60a5fa) 6%, transparent);
    border-radius: 0.5rem;
  }
</style>
