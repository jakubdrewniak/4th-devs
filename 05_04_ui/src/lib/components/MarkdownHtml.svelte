<script lang="ts">
import { collectLightboxableImages } from '../lightbox/lightbox-adapters'
import { tryGetLightboxContext } from '../lightbox/lightbox-context'
import {
  copyImageToClipboard,
  copyTextToClipboard,
  downloadImage,
  resolveDownloadFileName,
} from '../services/clipboard'
import { renderMarkdown } from '../services/markdown'

interface Props {
  source?: string
  highlight?: boolean
  appendCaret?: boolean
  className?: string
}

let { source = '', highlight = true, appendCaret = false, className = '' }: Props = $props()
const lightbox = tryGetLightboxContext()

const showButtonFeedback = (button: HTMLButtonElement, label: string) => {
  const previousText = button.dataset.feedbackText ?? button.textContent ?? ''
  button.dataset.feedbackText = previousText
  button.textContent = label

  window.setTimeout(() => {
    if (button.isConnected) {
      button.textContent = previousText
    }
  }, 1200)
}

const createMessageImageActionButton = (
  label: 'Copy' | 'Download',
  datasetKey: 'copyImage' | 'downloadImage',
): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sd-message-image-button'
  button.textContent = label
  button.dataset[datasetKey] = ''
  return button
}

const extensionForLanguage = (language: string): string => {
  const normalized = language.toLowerCase()
  switch (normalized) {
    case 'javascript':
    case 'js':
      return 'js'
    case 'typescript':
    case 'ts':
      return 'ts'
    case 'json':
      return 'json'
    case 'markdown':
    case 'md':
      return 'md'
    case 'html':
    case 'xml':
      return 'html'
    case 'css':
      return 'css'
    case 'bash':
    case 'shell':
    case 'sh':
      return 'sh'
    default:
      return normalized || 'txt'
  }
}

const downloadCode = (code: string, language: string) => {
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `snippet.${extensionForLanguage(language)}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}

const decorateMessageImages = (rootEl: HTMLDivElement) => {
  for (const img of rootEl.querySelectorAll('img')) {
    if (img.closest('[data-message-image]')) {
      continue
    }

    const sourceUrl = (img.getAttribute('src') || img.currentSrc || '').trim()
    if (!sourceUrl) {
      continue
    }

    const parentAnchor =
      img.parentElement instanceof HTMLAnchorElement && img.parentElement.childElementCount === 1
        ? img.parentElement
        : null
    const host = parentAnchor ?? img
    const wrapper = document.createElement('span')
    const actions = document.createElement('span')

    wrapper.className = 'sd-message-image'
    wrapper.dataset.messageImage = ''
    wrapper.dataset.imageAlt = (img.getAttribute('alt') || 'Image').trim() || 'Image'
    wrapper.dataset.imageSrc = sourceUrl

    actions.className = 'sd-message-image-actions'
    actions.append(
      createMessageImageActionButton('Copy', 'copyImage'),
      createMessageImageActionButton('Download', 'downloadImage'),
    )

    host.replaceWith(wrapper)
    wrapper.append(host, actions)
  }
}

const handleCodeAction = async (button: HTMLButtonElement) => {
  const codeBlock = button.closest<HTMLElement>('[data-code-block]')
  const codeElement = codeBlock?.querySelector<HTMLElement>('pre code')
  const code = codeElement?.textContent ?? ''
  const language = codeBlock?.dataset.language ?? 'text'

  if (!code) {
    return
  }

  if ('copyCode' in button.dataset) {
    await copyTextToClipboard(code)
    showButtonFeedback(button, 'Copied')
  }

  if ('downloadCode' in button.dataset) {
    downloadCode(code, language)
    showButtonFeedback(button, 'Saved')
  }
}

const handleImageAction = async (button: HTMLButtonElement) => {
  const wrapper = button.closest<HTMLElement>('[data-message-image]')
  const sourceUrl = wrapper?.dataset.imageSrc?.trim() ?? ''
  const alt = wrapper?.dataset.imageAlt?.trim() || 'Image'

  if (!sourceUrl) {
    return
  }

  if ('copyImage' in button.dataset) {
    await copyImageToClipboard(sourceUrl)
    showButtonFeedback(button, 'Copied')
    return
  }

  if ('downloadImage' in button.dataset) {
    await downloadImage(sourceUrl, resolveDownloadFileName(sourceUrl, alt))
    showButtonFeedback(button, 'Saved')
  }
}

const handleClick = async (rootEl: HTMLDivElement, event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  const button = target.closest<HTMLButtonElement>(
    '[data-copy-code], [data-download-code], [data-copy-image], [data-download-image]',
  )

  if (button) {
    event.preventDefault()
    event.stopPropagation()

    try {
      if ('copyImage' in button.dataset || 'downloadImage' in button.dataset) {
        await handleImageAction(button)
      } else {
        await handleCodeAction(button)
      }
    } catch {
      showButtonFeedback(button, 'Failed')
    }

    return
  }

  if (!lightbox) {
    return
  }

  if (target instanceof Element) {
    const img = target.closest('img')
    if (img && rootEl.contains(img)) {
      const root = rootEl.closest<HTMLElement>('[data-lightbox-gallery]') ?? rootEl
      const { items, elements } = collectLightboxableImages(root)
      const index = elements.indexOf(img as HTMLImageElement)
      if (index >= 0 && items.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        lightbox.openGallery(items, index)
      }
    }
  }
}

const attachMarkdownActions = (rootEl: HTMLDivElement, _html: string) => {
  decorateMessageImages(rootEl)

  const onClick = (event: MouseEvent) => {
    void handleClick(rootEl, event)
  }

  rootEl.addEventListener('click', onClick)

  return {
    update() {
      decorateMessageImages(rootEl)
    },
    destroy() {
      rootEl.removeEventListener('click', onClick)
    },
  }
}

const html = $derived(renderMarkdown(source, { appendCaret, highlight }))
</script>

<div class={`md-body ${className}`.trim()} use:attachMarkdownActions={html}>
  {@html html}
</div>
