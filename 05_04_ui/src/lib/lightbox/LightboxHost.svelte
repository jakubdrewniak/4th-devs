<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte'
import { getLightboxContext } from './lightbox-context'
import { isImageLightboxItem } from './lightbox-item'
import { resolveImageDisplayUrl } from '../services/authenticated-asset'
import { copyImageToClipboard, downloadImage, resolveDownloadFileName } from '../services/clipboard'
import { getShortcutManagerContext } from '../shortcuts/shortcut-manager'
import { getShortcutLayerStackContext } from '../ui/layer-stack'

const lightbox = getLightboxContext()
const layerStack = getShortcutLayerStackContext()
const shortcutManager = getShortcutManagerContext()

let panel: HTMLDivElement | null = $state(null)
let lastFocus: HTMLElement | null = null

let displayedUrl = $state('')
let displayState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle')
let disposeDisplayed: (() => void) | null = null
let copyLabel = $state('Copy')
let downloadLabel = $state('Download')
let actionTimer: number | null = null

const currentImageItem = $derived(
  lightbox.currentItem && isImageLightboxItem(lightbox.currentItem) ? lightbox.currentItem : null,
)

$effect(() => {
  if (!lightbox.isOpen) {
    return
  }

  const release = layerStack.pushLayer('lightbox', 'app-lightbox-host')
  return () => {
    release()
  }
})

$effect(() => {
  if (!lightbox.isOpen) {
    copyLabel = 'Copy'
    downloadLabel = 'Download'

    if (actionTimer != null) {
      window.clearTimeout(actionTimer)
      actionTimer = null
    }

    disposeDisplayed?.()
    disposeDisplayed = null
    displayedUrl = ''
    displayState = 'idle'
    return
  }

  const item = lightbox.currentItem
  if (!item) {
    disposeDisplayed?.()
    disposeDisplayed = null
    displayedUrl = ''
    displayState = 'idle'
    return
  }

  if (!isImageLightboxItem(item)) {
    disposeDisplayed?.()
    disposeDisplayed = null
    displayedUrl = ''
    displayState = 'idle'
    return
  }

  let cancelled = false
  const controller = new AbortController()
  disposeDisplayed?.()
  disposeDisplayed = null
  displayedUrl = ''
  displayState = 'loading'

  void resolveImageDisplayUrl(item.sourceUrl, controller.signal)
    .then((res) => {
      if (cancelled) {
        res.dispose()
        return
      }

      disposeDisplayed = res.dispose
      displayedUrl = res.displayUrl
      displayState = 'ready'
    })
    .catch(() => {
      if (!cancelled) {
        displayedUrl = ''
        displayState = 'error'
      }
    })

  return () => {
    cancelled = true
    controller.abort()
    disposeDisplayed?.()
    disposeDisplayed = null
  }
})

const setActionLabel = (type: 'copy' | 'download', value: string) => {
  if (type === 'copy') {
    copyLabel = value
  } else {
    downloadLabel = value
  }

  if (actionTimer != null) {
    window.clearTimeout(actionTimer)
  }

  actionTimer = window.setTimeout(() => {
    copyLabel = 'Copy'
    downloadLabel = 'Download'
    actionTimer = null
  }, 1200)
}

const handleCopyCurrentImage = async () => {
  if (!currentImageItem) {
    return
  }

  try {
    await copyImageToClipboard(currentImageItem.sourceUrl)
    setActionLabel('copy', 'Copied')
  } catch {
    setActionLabel('copy', 'Failed')
  }
}

const handleDownloadCurrentImage = async () => {
  if (!currentImageItem) {
    return
  }

  try {
    await downloadImage(
      currentImageItem.sourceUrl,
      resolveDownloadFileName(
        currentImageItem.sourceUrl,
        currentImageItem.caption ?? currentImageItem.alt,
      ),
    )
    setActionLabel('download', 'Saved')
  } catch {
    setActionLabel('download', 'Failed')
  }
}

$effect(() => {
  if (!lightbox.isOpen) {
    queueMicrotask(() => {
      if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
        lastFocus.focus()
      }
      lastFocus = null
    })
    return
  }

  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void tick().then(() => {
    panel?.focus()
  })
})

const handleBackdropPointerDown = (event: PointerEvent) => {
  if (event.target === event.currentTarget) {
    lightbox.close()
  }
}

const trapFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab' || !panel || !lightbox.isOpen) {
    return
  }

  const selectors =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  const focusables = [...panel.querySelectorAll<HTMLElement>(selectors)].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )

  if (focusables.length === 0) {
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  } else if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault()
    last?.focus()
  }
}

const panelAriaLabel = (): string => 'Image preview'

onMount(() => {
  const multi = () =>
    lightbox.items.length > 1 &&
    Boolean(lightbox.currentItem && isImageLightboxItem(lightbox.currentItem))

  return shortcutManager.registerShortcuts([
    {
      id: 'lightbox.close',
      description: 'Close image viewer',
      keys: ['Escape'],
      scope: 'lightbox',
      allowInEditable: true,
      run: () => {
        lightbox.close()
      },
    },
    {
      id: 'lightbox.prev',
      description: 'Previous image',
      keys: ['ArrowLeft'],
      scope: 'lightbox',
      allowInEditable: true,
      when: () => multi(),
      run: () => {
        lightbox.prev()
      },
    },
    {
      id: 'lightbox.next',
      description: 'Next image',
      keys: ['ArrowRight'],
      scope: 'lightbox',
      allowInEditable: true,
      when: () => multi(),
      run: () => {
        lightbox.next()
      },
    },
  ])
})

onDestroy(() => {
  if (actionTimer != null) {
    window.clearTimeout(actionTimer)
  }
})
</script>

{#if lightbox.isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-4 app-frosted"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      bind:this={panel}
      class="relative flex max-h-[min(92dvh,920px)] max-w-[min(96vw,1200px)] flex-col overflow-hidden rounded-xl border border-border bg-surface-0 shadow-lg outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={panelAriaLabel()}
      tabindex="-1"
      onkeydown={trapFocus}
    >
        <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <p class="min-w-0 truncate text-[13px] text-text-secondary">
            {#if lightbox.currentItem && isImageLightboxItem(lightbox.currentItem)}
              {lightbox.currentItem.caption?.trim() || lightbox.currentItem.alt}
            {:else}
              Preview
            {/if}
          </p>
          <div class="flex shrink-0 items-center gap-1">
            {#if lightbox.items.length > 1}
              <span class="pr-2 text-[12px] tabular-nums text-text-tertiary">
                {lightbox.index + 1} / {lightbox.items.length}
              </span>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Previous image"
                onclick={() => {
                  lightbox.prev()
                }}
              >
                Prev
              </button>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Next image"
                onclick={() => {
                  lightbox.next()
                }}
              >
                Next
              </button>
            {/if}
            {#if currentImageItem}
              <button
                type="button"
                class="ml-1 rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Copy image to clipboard"
                onclick={() => {
                  void handleCopyCurrentImage()
                }}
              >
                {copyLabel}
              </button>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Download image"
                onclick={() => {
                  void handleDownloadCurrentImage()
                }}
              >
                {downloadLabel}
              </button>
            {/if}
            <button
              type="button"
              class="ml-1 rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
              aria-label="Close preview"
              onclick={() => {
                lightbox.close()
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div class="flex min-h-0 flex-1 items-center justify-center bg-surface-1 p-3">
          {#if displayedUrl}
            <img
              src={displayedUrl}
              alt={lightbox.currentItem && isImageLightboxItem(lightbox.currentItem) ? lightbox.currentItem.alt : 'Preview'}
              class="max-h-[min(85dvh,880px)] max-w-full object-contain"
            />
          {:else if displayState === 'error'}
            <div class="flex h-48 w-full max-w-md items-center justify-center text-[13px] text-text-tertiary">
              Preview unavailable.
            </div>
          {:else}
            <div class="flex h-48 w-full max-w-md items-center justify-center text-[13px] text-text-tertiary">
              Loading…
            </div>
          {/if}
        </div>
    </div>
  </div>
{/if}
