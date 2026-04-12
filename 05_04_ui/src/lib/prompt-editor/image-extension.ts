import { mergeAttributes, Node } from '@tiptap/core'

const escapeMarkdownText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')

const escapeMarkdownTitle = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export const PromptImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: '',
      },
      title: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  markdownTokenName: 'image',

  parseMarkdown(token, helpers) {
    return helpers.createNode('image', {
      src: token.href ?? '',
      alt: token.text ?? '',
      title: token.title ?? null,
    })
  },

  renderMarkdown(node) {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src.trim() : ''
    if (!src) {
      return ''
    }

    const alt = typeof node.attrs?.alt === 'string' ? escapeMarkdownText(node.attrs.alt) : ''
    const title =
      typeof node.attrs?.title === 'string' && node.attrs.title.trim().length > 0
        ? ` "${escapeMarkdownTitle(node.attrs.title)}"`
        : ''

    return `![${alt}](${src}${title})`
  },
})
