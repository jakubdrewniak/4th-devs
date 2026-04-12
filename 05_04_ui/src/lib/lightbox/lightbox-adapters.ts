import type { MessageAttachment } from '../../../shared/chat'
import type { AttachmentDraft } from '../stores/attachment-drafts.svelte'
import type { LightboxItem } from './lightbox-item'

/** Image drafts in tray order → lightbox items (skips non-images). */
export const imageDraftsToLightboxItems = (drafts: readonly AttachmentDraft[]): LightboxItem[] =>
  drafts
    .filter((d) => d.kind === 'image')
    .map((draft) => {
      const sourceUrl = draft.remoteUrl?.trim() || draft.previewUrl?.trim() || draft.objectUrl || ''
      return {
        kind: 'image' as const,
        sourceUrl,
        alt: draft.name || 'Attachment',
        caption: draft.name,
      }
    })
    .filter((item) => item.sourceUrl.length > 0)

/** Message image attachments → lightbox items (canonical URLs for authenticated assets). */
export const imageAttachmentsToLightboxItems = (
  attachments: readonly MessageAttachment[],
): LightboxItem[] =>
  attachments
    .filter((a) => a.kind === 'image')
    .map((attachment) => ({
      kind: 'image' as const,
      sourceUrl: attachment.url,
      alt: attachment.name || 'Image',
      caption: attachment.name,
    }))

export const isLightboxableImageSrc = (raw: string): boolean => {
  const t = raw.trim()
  if (!t) {
    return false
  }
  if (t.startsWith('blob:') || t.startsWith('data:')) {
    return false
  }
  return true
}

export const collectLightboxableImages = (
  root: HTMLElement | null,
): { items: LightboxItem[]; elements: HTMLImageElement[] } => {
  if (!root) {
    return { items: [], elements: [] }
  }

  const elements: HTMLImageElement[] = []
  const items: LightboxItem[] = []

  for (const img of root.querySelectorAll('img')) {
    const raw = (img.currentSrc || img.getAttribute('src') || '').trim()
    if (!isLightboxableImageSrc(raw)) {
      continue
    }

    elements.push(img)
    items.push({
      kind: 'image',
      sourceUrl: raw,
      alt: (img.getAttribute('alt') || 'Image').trim() || 'Image',
    })
  }

  return { items, elements }
}

/**
 * Maps `<img>` elements under `root` to lightbox items using `currentSrc`/`src` attributes
 * (backend paths survive virtualization; blob URLs are skipped).
 */
export const imageElementsToLightboxItems = (root: HTMLElement | null): LightboxItem[] =>
  collectLightboxableImages(root).items
