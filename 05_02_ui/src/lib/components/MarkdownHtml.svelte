<script lang="ts">
  import { onMount } from 'svelte'
  import { renderMarkdown } from '../services/markdown'

  interface Props {
    source?: string
    highlight?: boolean
    appendCaret?: boolean
    className?: string
  }

  let {
    source = '',
    highlight = true,
    appendCaret = false,
    className = '',
  }: Props = $props()

  let container: HTMLDivElement | null = $state(null)

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

  const copyToClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
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

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const button = target.closest<HTMLButtonElement>(
      '[data-copy-code], [data-download-code]',
    )
    if (!button) {
      return
    }

    const codeBlock = button.closest<HTMLElement>('[data-code-block]')
    const codeElement = codeBlock?.querySelector<HTMLElement>('pre code')
    const code = codeElement?.textContent ?? ''
    const language = codeBlock?.dataset.language ?? 'text'

    if (!code) {
      return
    }

    if ('copyCode' in button.dataset) {
      await copyToClipboard(code)
      showButtonFeedback(button, 'Copied')
      return
    }

    if ('downloadCode' in button.dataset) {
      downloadCode(code, language)
      showButtonFeedback(button, 'Saved')
    }
  }

  const attachMarkdownActions = (node: HTMLDivElement) => {
    const onClick = (event: MouseEvent) => {
      void handleClick(event)
    }

    node.addEventListener('click', onClick)

    return {
      destroy() {
        node.removeEventListener('click', onClick)
      },
    }
  }

  const html = $derived(renderMarkdown(source, { appendCaret, highlight }))
</script>

<div bind:this={container} class={`md-body ${className}`.trim()} use:attachMarkdownActions>
  {@html html}
</div>
