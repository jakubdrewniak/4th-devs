import { getContext, setContext } from 'svelte'

export type ViewOrigin =
  | { kind: 'agent-form'; agentId?: string }
  | { kind: 'tool-profile-form'; toolProfileId?: string }
  | { kind: 'mcp-form'; serverId?: string }

export type ActiveView =
  | { kind: 'chat' }
  | { kind: 'mcp-form'; serverId?: string; origin?: ViewOrigin }
  | { kind: 'agent-form'; agentId?: string }
  | { kind: 'tool-profile-form'; toolProfileId?: string; origin?: ViewOrigin }

const VIEW_STORE_CONTEXT = Symbol('view-store')

export interface ViewStore {
  readonly activeView: ActiveView
  readonly isDirty: boolean
  openChat: () => void
  openMcpForm: (serverId?: string, origin?: ViewOrigin) => void
  openAgentForm: (agentId?: string) => void
  openToolProfileForm: (toolProfileId?: string, origin?: ViewOrigin) => void
  registerDirtyGuard: (guard: () => boolean) => void
  clearDirtyGuard: () => void
}

export const createViewStore = (): ViewStore => {
  let activeView = $state<ActiveView>({ kind: 'chat' })
  let dirtyGuard: (() => boolean) | null = null

  const navigateTo = (next: ActiveView) => {
    dirtyGuard = null
    activeView = next
  }

  return {
    get activeView() {
      return activeView
    },
    get isDirty() {
      return dirtyGuard?.() ?? false
    },
    openChat() {
      navigateTo({ kind: 'chat' })
    },
    openMcpForm(serverId, origin) {
      navigateTo({ kind: 'mcp-form', ...(serverId ? { serverId } : {}), ...(origin ? { origin } : {}) })
    },
    openAgentForm(agentId) {
      navigateTo({ kind: 'agent-form', ...(agentId ? { agentId } : {}) })
    },
    openToolProfileForm(toolProfileId, origin) {
      navigateTo({ kind: 'tool-profile-form', ...(toolProfileId ? { toolProfileId } : {}), ...(origin ? { origin } : {}) })
    },
    registerDirtyGuard(guard) {
      dirtyGuard = guard
    },
    clearDirtyGuard() {
      dirtyGuard = null
    },
  }
}

export const setViewStoreContext = (store: ViewStore): ViewStore => {
  setContext(VIEW_STORE_CONTEXT, store)
  return store
}

export const getViewStoreContext = (): ViewStore =>
  getContext<ViewStore>(VIEW_STORE_CONTEXT)
