<script lang="ts">
import { imageDraftsToLightboxItems } from '../../lightbox/lightbox-adapters'
import { tryGetLightboxContext } from '../../lightbox/lightbox-context'
import type { AttachmentDraft } from '../../stores/attachment-drafts.svelte'
import FileChip from '../FileChip.svelte'
import ImageTile from '../ImageTile.svelte'

interface Props {
  disabled?: boolean
  drafts?: AttachmentDraft[]
  onRemove?: ((localId: string) => void) | null
}

let { disabled = false, drafts = [], onRemove = null }: Props = $props()
const lightbox = tryGetLightboxContext()

const openDraftLightbox = (localId: string) => {
  if (!lightbox) {
    return
  }

  const imageDrafts = drafts.filter((draft) => draft.kind === 'image')
  const items = imageDraftsToLightboxItems(imageDrafts)
  const index = imageDrafts.findIndex((draft) => draft.localId === localId)
  lightbox.openGallery(items, Math.max(0, index))
}

const draftStatusLabel = (draft: AttachmentDraft): string | null => {
  if (draft.error) {
    return draft.error
  }

  switch (draft.state) {
    case 'queued':
      return 'Queued'

    case 'uploading':
      return 'Uploading…'

    case 'error':
      return 'Upload failed'

    default:
      return null
  }
}
</script>

{#if drafts.length > 0}
  <div class="flex flex-wrap items-start gap-2 pb-2.5" role="list" aria-label="Pending attachments">
    {#each drafts as draft (draft.localId)}
      {#if draft.kind === 'image'}
        <ImageTile
          alt={draft.name}
          src={draft.previewUrl ?? draft.objectUrl}
          href={draft.remoteUrl ?? draft.objectUrl}
          variant="tray"
          statusLabel={draftStatusLabel(draft)}
          onOpenPreview={() => {
            openDraftLightbox(draft.localId)
          }}
          onRemove={onRemove ? () => onRemove(draft.localId) : null}
          {disabled}
        />
      {:else}
        <FileChip
          attachment={draft}
          href={draft.objectUrl}
          variant="tray"
          statusLabel={draftStatusLabel(draft)}
          onRemove={onRemove ? () => onRemove(draft.localId) : null}
          {disabled}
        />
      {/if}
    {/each}
  </div>
{/if}
