import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import { track } from '../utils/perf'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdownLanguage from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import MarkdownIt from 'markdown-it'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdownLanguage)
hljs.registerLanguage('md', markdownLanguage)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('text', plaintext)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('xml', xml)

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escapeAttribute = (str: string): string =>
  escapeHtml(str).replace(/'/g, '&#39;')

const resolveLanguage = (language: string): string =>
  language && hljs.getLanguage(language) ? language : 'plaintext'

const renderCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 400
const CARET_SPAN = '<span class="caret-blink" aria-hidden="true"></span>'

const defaultSanitizeConfig = {
  ADD_ATTR: [
    'aria-hidden',
    'aria-label',
    'data-code-block',
    'data-copy-code',
    'data-download-code',
    'data-language',
    'tabindex',
    'target',
    'rel',
    'loading',
    'decoding',
  ],
  ADD_TAGS: ['button'],
}

const prettyLanguageLabel = (language: string): string => {
  const normalized = language.toLowerCase()

  switch (normalized) {
    case '':
    case 'plaintext':
      return 'text'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    case 'md':
      return 'markdown'
    case 'sh':
      return 'shell'
    default:
      return normalized
  }
}

const trimTrailingNewlines = (code: string): string => code.replace(/\n+$/, '')

const renderCodeBlock = (
  code: string,
  info: string,
  highlight: boolean,
): string => {
  const [languageHint = ''] = info.trim().split(/\s+/)
  const resolvedLanguage = resolveLanguage(languageHint)
  const label = prettyLanguageLabel(languageHint || resolvedLanguage)
  const trimmedCode = trimTrailingNewlines(code)
  const renderedCode = highlight
    ? hljs.highlight(trimmedCode, { language: resolvedLanguage }).value
    : escapeHtml(trimmedCode)

  const wrappedLines = renderedCode
    .split('\n')
    .map(line => `<span class="line">${line}</span>`)
    .join('')

  return [
    `<div class="sd-code-block" data-code-block data-language="${escapeAttribute(label)}">`,
    '<div class="sd-code-header">',
    `<span class="sd-code-language">${escapeHtml(label)}</span>`,
    '<div class="sd-code-actions">',
    '<button class="sd-code-button" type="button" data-copy-code>Copy</button>',
    '<button class="sd-code-button" type="button" data-download-code>Download</button>',
    '</div>',
    '</div>',
    `<pre class="code-shell" tabindex="0"><code class="hljs language-${escapeAttribute(resolvedLanguage)}">${wrappedLines}</code></pre>`,
    '</div>',
  ].join('')
}

const addSharedRendererRules = (md: MarkdownIt, highlight: boolean) => {
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noreferrer')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  const defaultTableOpen =
    md.renderer.rules.table_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  const defaultTableClose =
    md.renderer.rules.table_close ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`
  md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
    `${defaultTableClose(tokens, idx, options, env, self)}</div>`

  const defaultImage = md.renderer.rules.image
  if (defaultImage) {
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      tokens[idx].attrSet('loading', 'lazy')
      tokens[idx].attrSet('decoding', 'async')
      return defaultImage(tokens, idx, options, env, self)
    }
  }

  md.renderer.rules.fence = (tokens, idx) =>
    renderCodeBlock(tokens[idx].content, tokens[idx].info, highlight)

  md.renderer.rules.code_block = (tokens, idx) =>
    renderCodeBlock(tokens[idx].content, '', highlight)
}

const createMarkdownRenderer = (highlight: boolean) => {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
  })

  addSharedRendererRules(md, highlight)
  return md
}

const mdHighlighted = createMarkdownRenderer(true)
const mdPlain = createMarkdownRenderer(false)

const injectCaret = (html: string): string => {
  const closingTags = [
    '</p>',
    '</li>',
    '</td>',
    '</th>',
    '</blockquote>',
    '</h1>',
    '</h2>',
    '</h3>',
    '</h4>',
  ]

  let bestPosition = -1

  for (const tag of closingTags) {
    const position = html.lastIndexOf(tag)
    if (position > bestPosition) {
      bestPosition = position
    }
  }

  if (bestPosition !== -1) {
    return html.slice(0, bestPosition) + CARET_SPAN + html.slice(bestPosition)
  }

  return html + CARET_SPAN
}

const sanitizeHtml = (html: string): string => {
  if (typeof window === 'undefined') {
    return html
  }

  return track('dompurify', () => DOMPurify.sanitize(html, defaultSanitizeConfig))
}

const remember = (key: string, value: string): string => {
  renderCache.set(key, value)
  if (renderCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = renderCache.keys().next().value
    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey)
    }
  }

  return value
}

export interface RenderMarkdownOptions {
  appendCaret?: boolean
  highlight?: boolean
}

/**
 * Renders markdown to safe HTML.
 * `highlight=false` keeps code blocks cheap during active streaming.
 * `appendCaret=true` injects the typing caret into the last textual block.
 */
export const renderMarkdown = (
  content: string,
  options: boolean | RenderMarkdownOptions = true,
): string => {
  const normalizedOptions =
    typeof options === 'boolean'
      ? { appendCaret: false, highlight: options }
      : { appendCaret: false, highlight: true, ...options }

  const key = `${normalizedOptions.highlight ? '1' : '0'}:${normalizedOptions.appendCaret ? '1' : '0'}:${content}`
  const cached = renderCache.get(key)

  if (cached !== undefined) {
    track('renderMarkdown', () => undefined, true)
    return cached
  }

  return track('renderMarkdown', () => {
    const rendered = normalizedOptions.highlight
      ? mdHighlighted.render(content)
      : mdPlain.render(content)

    const withCaret = normalizedOptions.appendCaret ? injectCaret(rendered) : rendered
    const sanitized = sanitizeHtml(withCaret)

    return remember(key, sanitized)
  }, false)
}
