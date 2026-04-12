import type { MessageAttachment } from '../../../shared/chat'
import {
  createAttachmentDraftStore,
  type AttachmentDraft,
  type AttachmentDraftStoreDependencies,
} from './attachment-drafts.svelte'

type AttachmentDraftStore = ReturnType<typeof createAttachmentDraftStore>

export interface ComposerAttachmentStore {
  readonly drafts: AttachmentDraft[]
  readonly error: string | null
  addFiles(files: File[]): AttachmentDraft[]
  addUploadedAttachments(attachments: MessageAttachment[]): AttachmentDraft[]
  removeDraft(localId: string): boolean
  prepareForSubmit():
    | {
        ok: true
        attachments: MessageAttachment[]
      }
    | {
        ok: false
        error: string
      }
  clearError(): void
  reset(): void
  dispose(): void
}

export interface ComposerAttachmentStoreDependencies extends AttachmentDraftStoreDependencies {}

export const createComposerAttachmentStore = (
  dependencies: ComposerAttachmentStoreDependencies = {},
): ComposerAttachmentStore => {
  const createDraftStore = () => createAttachmentDraftStore(dependencies)

  const state = $state<{
    activeStore: AttachmentDraftStore
    error: string | null
    retainedStores: AttachmentDraftStore[]
  }>({
    activeStore: createDraftStore(),
    error: null,
    retainedStores: [],
  })

  const disposeStores = (stores: AttachmentDraftStore[]) => {
    for (const store of stores) {
      store.dispose()
    }
  }

  const replaceActiveStore = () => {
    const previousActiveStore = state.activeStore
    state.retainedStores.push(previousActiveStore)
    state.activeStore = createDraftStore()
  }

  return {
    get drafts() {
      return state.activeStore.drafts
    },

    get error() {
      return state.error
    },

    addFiles(files) {
      state.error = null
      const drafts = state.activeStore.addFiles(files)
      void state.activeStore.uploadPendingFiles()
      return drafts
    },

    addUploadedAttachments(attachments) {
      state.error = null
      return state.activeStore.addUploadedAttachments(attachments)
    },

    removeDraft(localId) {
      state.error = null
      return state.activeStore.removeDraft(localId)
    },

    prepareForSubmit() {
      const validation = state.activeStore.validateReadyForSubmit()
      if (!validation.ok) {
        state.error = validation.error
        return validation
      }

      const attachments = state.activeStore.toDraftAttachments()
      if (attachments.length === 0) {
        state.error = null
        return {
          ok: true,
          attachments: [],
        }
      }

      state.error = null
      replaceActiveStore()
      return {
        ok: true,
        attachments,
      }
    },

    clearError() {
      state.error = null
    },

    reset() {
      state.error = null
      state.activeStore.dispose()
      disposeStores(state.retainedStores)
      state.activeStore = createDraftStore()
      state.retainedStores = []
    },

    dispose() {
      state.error = null
      state.activeStore.dispose()
      disposeStores(state.retainedStores)
      state.retainedStores = []
    },
  }
}
