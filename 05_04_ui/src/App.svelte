<script lang="ts">
import { onMount } from 'svelte'
import {
  createCommandRegistry,
  createCommandsProvider,
} from './lib/command-palette/command-registry'
import { createConfirmProvider } from './lib/command-palette/confirm-provider'
import { createConversationProvider } from './lib/command-palette/conversation-provider.svelte'
import { createAgentBrowserProvider } from './lib/command-palette/agent-browser-provider.svelte'
import { createMcpBrowserProvider } from './lib/command-palette/mcp-browser-provider.svelte'
import { createToolProfileBrowserProvider } from './lib/command-palette/tool-profile-browser-provider.svelte'
import {
  createPaletteStore,
  setPaletteStoreContext,
} from './lib/command-palette/palette-store.svelte'
import { createRenameProvider } from './lib/command-palette/rename-provider'
import { createWorkspaceProvider } from './lib/command-palette/workspace-provider.svelte'
import { createAppCommands, setAppCommandsContext } from './lib/commands/app-commands'
import AgentForm from './lib/components/agents/AgentForm.svelte'
import BackgroundActivityBar from './lib/components/composer/BackgroundActivityBar.svelte'
import ChatComposer from './lib/components/composer/ChatComposer.svelte'
import VirtualMessageList from './lib/components/message-list/VirtualMessageList.svelte'
import ToolProfileForm from './lib/components/tool-profiles/ToolProfileForm.svelte'
import LightboxHost from './lib/lightbox/LightboxHost.svelte'
import { setLightboxContext } from './lib/lightbox/lightbox-context'
import { createLightboxController } from './lib/lightbox/lightbox-controller.svelte'
import ResizeHandles from './lib/components/ResizeHandles.svelte'
import McpServerForm from './lib/mcp/McpServerForm.svelte'
import { getThread, listAgents, listMcpServers, listThreads, listToolProfiles } from './lib/services/api'
import {
  type BrowserAuthSession,
  getAuthSession,
  loginWithPassword,
  logout,
} from './lib/services/auth'
import { getApiTenantId, setApiTenantId } from './lib/services/backend'
import { humanizeErrorMessage } from './lib/services/response-errors'
import { createAppShortcutDefinitions } from './lib/shortcuts/app-shortcuts'
import { createShortcutManager, setShortcutManagerContext } from './lib/shortcuts/shortcut-manager'
import { createBackgroundActivityStore } from './lib/stores/background-activity.svelte'
import { chatStore } from './lib/stores/chat-store.svelte'
import { chatWidth } from './lib/stores/chat-width.svelte'
import {
  createMessageNavigator,
  setMessageNavigatorContext,
} from './lib/stores/message-navigator.svelte'
import { themeStore } from './lib/stores/theme.svelte'
import { typewriter } from './lib/stores/typewriter.svelte'
import {
  createViewStore,
  setViewStoreContext,
} from './lib/stores/view-store.svelte'
import { createShortcutLayerStack, setShortcutLayerStackContext } from './lib/ui/layer-stack'

let isSafari = $state(false)
let pinToBottomRequest = $state(0)
let initialHydrationPending = $state(true)
let authCheckPending = $state(true)
let showConnectingScreen = $state(false)
let authError = $state<string | null>(null)
let authSession = $state<BrowserAuthSession | null>(null)
let loginEmail = $state('')
let loginPassword = $state('')
let loginPending = $state(false)
let logoutPending = $state(false)
let tenantChangePending = $state(false)
let selectedTenantId = $state<string | null>(getApiTenantId())

const shortcutLayerStack = setShortcutLayerStackContext(createShortcutLayerStack())
const messageNavigator = setMessageNavigatorContext(createMessageNavigator())
const viewStore = setViewStoreContext(createViewStore())
const lightboxController = setLightboxContext(createLightboxController())
const backgroundActivity = createBackgroundActivityStore({
  currentThreadId: () => chatStore.threadId,
  sessionId: () => authSession?.auth.kind === 'auth_session' ? authSession.auth.sessionId : selectedTenantId,
})
const paletteStore = setPaletteStoreContext(
  createPaletteStore({
    layerStack: shortcutLayerStack,
  }),
)
const conversationProvider = createConversationProvider({
  currentThreadId: () => chatStore.threadId,
  listThreads,
  onSwitchThread: async (thread) => {
    viewStore.openChat()
    await chatStore.switchToThread(thread)
  },
})
const workspaceProvider = createWorkspaceProvider({
  currentTenantId: () => selectedTenantId,
  getMemberships: () => authSession?.memberships ?? [],
  onSwitchTenant: async (tenantId) => {
    await handleTenantSelect(tenantId)
  },
})
const agentBrowserProvider = createAgentBrowserProvider({
  listAgents,
  onEditAgent: (agent) => {
    viewStore.openAgentForm(agent.id)
  },
  onCreateNew: () => {
    viewStore.openAgentForm()
  },
})
const mcpBrowserProvider = createMcpBrowserProvider({
  listMcpServers,
  onEditServer: (entry) => {
    viewStore.openMcpForm(entry.id)
  },
  onConnectNew: () => {
    viewStore.openMcpForm()
  },
  onRefreshServer: () => {},
  onDeleteServer: () => {},
  onAuthorizeServer: () => {},
  onOpenTools: (entry) => {
    console.log('[app:onOpenTools]', { entryId: entry.id, entryLabel: entry.label })
    viewStore.openMcpForm(entry.id)
  },
})
const toolProfileBrowserProvider = createToolProfileBrowserProvider({
  listToolProfiles,
  onCreateNew: () => {
    viewStore.openToolProfileForm()
  },
  onEditProfile: (profile) => {
    viewStore.openToolProfileForm(profile.id)
  },
})
const appCommands = setAppCommandsContext(
  createAppCommands({
    canOpenAgentPanel: () => Boolean(authSession && selectedTenantId),
    canOpenConversationPicker: () => Boolean(authSession && selectedTenantId),
    canOpenWorkspacePicker: () =>
      Boolean(authSession && authSession.memberships.length > 1) &&
      !loginPending &&
      !logoutPending &&
      !tenantChangePending,
    canSignOut: () =>
      Boolean(authSession) && !loginPending && !logoutPending && !tenantChangePending,
    chatStore,
    listThreads,
    requestDeleteConversationConfirmation: ({ currentTitle }) =>
      new Promise<boolean>((resolve) => {
        paletteStore.openWith(
          createConfirmProvider({
            title: `Delete "${currentTitle || 'Untitled'}"?`,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          }),
        )
      }),
    requestRenameConversationTitle: ({ currentTitle }) =>
      new Promise<string | null>((resolve) => {
        const provider = createRenameProvider({
          currentTitle,
          getCurrentTitle: () => chatStore.currentThreadTitle?.trim() || currentTitle,
          onRename: (title) => resolve(title),
          onRegenerate: () => {
            void chatStore.regenerateCurrentThreadTitle()
          },
          canRegenerate: () =>
            Boolean(chatStore.threadId) &&
            !chatStore.isLoading &&
            !chatStore.isStreaming &&
            !chatStore.isCancelling &&
            !chatStore.isWaiting &&
            !chatStore.isThreadNaming,
          isRegenerating: () => chatStore.isThreadNaming,
          onCancel: () => resolve(null),
        })
        paletteStore.openWith(provider)
        paletteStore.setQuery(currentTitle)
      }),
    openConversationPicker: () => {
      paletteStore.openWith(conversationProvider)
    },
    openWorkspacePicker: () => {
      paletteStore.openWith(workspaceProvider)
    },
    openAgentPanel: () => {
      paletteStore.openWith(agentBrowserProvider)
    },
    openNewAgent: () => {
      viewStore.openAgentForm()
    },
    openConnectMcp: () => {
      viewStore.openMcpForm()
    },
    openManageMcp: () => {
      paletteStore.openWith(mcpBrowserProvider)
    },
    openManageToolProfiles: () => {
      paletteStore.openWith(toolProfileBrowserProvider)
    },
    requestPinToBottom: () => {
      pinToBottomRequest += 1
    },
    signOut: async () => {
      await handleLogout()
    },
    theme: themeStore,
    typewriter,
  }),
)
const shortcutManager = setShortcutManagerContext(
  createShortcutManager({
    layerStack: shortcutLayerStack,
  }),
)

const commandItems = createCommandRegistry(appCommands).filter(
  (item) => item.surfaces?.includes('slash') ?? true,
)
const commandsProvider = createCommandsProvider(appCommands)

$effect(() => {
  if (paletteStore.activeProvider?.id !== 'rename') {
    return
  }

  const nextTitle = chatStore.currentThreadTitle?.trim() ?? ''
  if (!nextTitle || nextTitle === paletteStore.query.trim()) {
    return
  }

  paletteStore.setQuery(nextTitle)
})

const unregisterAppShortcuts = shortcutManager.registerShortcuts(
  createAppShortcutDefinitions({ appCommands, paletteStore, commandsProvider }),
)

const toDisplayError = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return humanizeErrorMessage(error.message)
  }

  return fallback
}

const resolvePreferredTenantId = (session: BrowserAuthSession): string | null => {
  const membershipIds = new Set(session.memberships.map((membership) => membership.tenantId))
  const preferredTenantId = getApiTenantId() ?? session.tenantScope?.tenantId ?? null

  if (preferredTenantId && membershipIds.has(preferredTenantId)) {
    return preferredTenantId
  }

  return session.memberships[0]?.tenantId ?? null
}

const applyAuthenticatedSession = async (
  session: BrowserAuthSession,
  options: { resetChat?: boolean } = {},
): Promise<void> => {
  const previousTenantId = getApiTenantId()
  const nextTenantId = resolvePreferredTenantId(session)
  const shouldResetChat =
    options.resetChat === true || (previousTenantId !== null && previousTenantId !== nextTenantId)

  selectedTenantId = nextTenantId
  setApiTenantId(nextTenantId)

  if (shouldResetChat || !nextTenantId) {
    await chatStore.reset({ clearTargetSelection: true })
    backgroundActivity.reset()
  }

  const resolvedSession = nextTenantId ? ((await getAuthSession()) ?? session) : session
  authSession = resolvedSession
  loginEmail = resolvedSession.account.email ?? loginEmail

  if (nextTenantId) {
    await chatStore.hydrate(0)
    backgroundActivity.start()
  }
}

const initializeAuth = async (): Promise<void> => {
  authError = null
  const session = await getAuthSession()

  if (!session) {
    authSession = null
    selectedTenantId = getApiTenantId()
    return
  }

  await applyAuthenticatedSession(session)
}

const handleLoginSubmit = async (event: SubmitEvent): Promise<void> => {
  event.preventDefault()

  if (loginPending || logoutPending || tenantChangePending) {
    return
  }

  const email = loginEmail.trim()
  if (!email || !loginPassword.trim()) {
    authError = 'Email and password are required.'
    return
  }

  loginPending = true
  authError = null
  initialHydrationPending = true

  try {
    const session = await loginWithPassword({
      email,
      password: loginPassword,
    })

    loginEmail = email
    loginPassword = ''
    await applyAuthenticatedSession(session, { resetChat: true })
  } catch (error) {
    authError = toDisplayError(error, 'Could not sign in.')
  } finally {
    loginPending = false
    initialHydrationPending = false
  }
}

const handleLogout = async (): Promise<void> => {
  if (logoutPending || loginPending || tenantChangePending) {
    return
  }

  logoutPending = true
  authError = null

  try {
    await logout()
    loginPassword = ''
    setApiTenantId(null)
    selectedTenantId = null
    await chatStore.reset({ clearTargetSelection: true })
    backgroundActivity.stop()
    authSession = null
  } catch (error) {
    authError = toDisplayError(error, 'Could not sign out.')
  } finally {
    logoutPending = false
    initialHydrationPending = false
  }
}

const handleTenantSelect = async (tenantId: string): Promise<void> => {
  if (!authSession || !tenantId || tenantId === selectedTenantId) {
    return
  }
  const nextTenantId = tenantId

  tenantChangePending = true
  authError = null
  initialHydrationPending = true

  try {
    selectedTenantId = nextTenantId
    setApiTenantId(nextTenantId)
    await chatStore.reset({ clearTargetSelection: true })

    const refreshedSession = await getAuthSession()
    if (!refreshedSession) {
      authSession = null
      return
    }

    authSession = refreshedSession
    await chatStore.hydrate(0)
  } catch (error) {
    authError = toDisplayError(error, 'Could not switch workspace.')
  } finally {
    tenantChangePending = false
    initialHydrationPending = false
  }
}

onMount(() => {
  let disposed = false

  isSafari = /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent)

  document.documentElement.dataset.browser = isSafari ? 'safari' : 'other'
  const stopShortcutListener = shortcutManager.start()

  const connectingTimer = setTimeout(() => {
    if (!disposed && authCheckPending) {
      showConnectingScreen = true
    }
  }, 300)

  void (async () => {
    try {
      await initializeAuth()
    } catch (error) {
      if (!disposed) {
        authError = toDisplayError(error, 'Could not start the app.')
      }
    } finally {
      if (!disposed) {
        authCheckPending = false
        showConnectingScreen = false
        initialHydrationPending = false
      }
    }
  })()

  return () => {
    disposed = true
    clearTimeout(connectingTimer)
    stopShortcutListener()
    unregisterAppShortcuts()
    messageNavigator.dispose()
    chatStore.dispose()
    backgroundActivity.stop()
    delete document.documentElement.dataset.browser
  }
})

// Deactivate message navigator when the active thread changes.
$effect(() => {
  chatStore.threadId // subscribe
  messageNavigator.deactivate()
})
</script>

<svelte:head>
  <title>Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=Lexend+Deca:wght@100..900&family=Lexend:wght@100..900&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="min-h-dvh flex flex-col bg-bg" style:--chat-max-w="{chatWidth.value}px" data-safari={isSafari || undefined}>
  {#if authCheckPending && showConnectingScreen}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm">
        <div class="flex items-center gap-3">
          <span class="h-2.5 w-2.5 rounded-full bg-accent animate-pulse"></span>
          <h1 class="text-lg font-semibold text-text-primary font-heading">Connecting to the workspace</h1>
        </div>
        <p class="mt-3 text-sm text-text-secondary">
          Waiting for the API to answer the initial auth check.
        </p>
      </div>
    </div>
  {:else if authCheckPending}
    <div class="flex-1"></div>
  {:else if !authSession}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <form
        class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm"
        onsubmit={handleLoginSubmit}
      >
        <h1 class="text-2xl font-semibold text-text-primary font-heading">Welcome back</h1>
        <p class="mt-2 text-sm text-text-secondary">
          Sign in to continue to your workspace.
        </p>

        <label class="mt-6 block text-sm font-medium text-text-primary" for="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          bind:value={loginEmail}
          autocomplete="email"
          class="mt-2 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          placeholder="you@example.com"
          required
        />

        <label class="mt-4 block text-sm font-medium text-text-primary" for="login-password">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          bind:value={loginPassword}
          autocomplete="current-password"
          class="mt-2 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          placeholder="Enter your password"
          required
        />

        {#if authError}
          <p class="mt-4 rounded-lg border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger-text">
            {authError}
          </p>
        {/if}

        <button
          type="submit"
          class="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-text-primary px-4 py-3 text-sm font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loginPending}
        >
          {loginPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  {:else if authSession.memberships.length === 0}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm">
        <h1 class="text-2xl font-semibold text-text-primary">
          {authSession.account.name ?? authSession.account.email ?? authSession.account.id}
        </h1>
        <p class="mt-3 text-sm text-text-secondary">
          You're signed in, but you don't have access to any workspace yet. Contact your admin to get added.
        </p>
        {#if authError}
          <p class="mt-4 rounded-lg border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger-text">
            {authError}
          </p>
        {/if}
        <button
          type="button"
          class="mt-6 inline-flex items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-surface-1"
          onclick={handleLogout}
          disabled={logoutPending}
        >
          {logoutPending ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </div>
  {:else}
    <div class="flex-1 flex flex-col min-h-0 relative">
      {#if authError}
        <div class="px-4 pt-4 md:px-6">
          <p class="rounded-xl border border-danger/15 bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
            {authError}
          </p>
        </div>
      {/if}

      {#if viewStore.activeView.kind === 'mcp-form'}
        {#key viewStore.activeView.serverId ?? '__new__'}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <McpServerForm
              serverId={viewStore.activeView.serverId}
              origin={viewStore.activeView.origin}
              onClose={() => viewStore.openChat()}
            />
          </div>
        {/key}
      {:else if viewStore.activeView.kind === 'agent-form'}
        {#key viewStore.activeView.agentId ?? '__new__'}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <AgentForm
              agentId={viewStore.activeView.agentId}
              currentAccountId={authSession?.account.id ?? null}
              onClose={() => viewStore.openChat()}
            />
          </div>
        {/key}
      {:else if viewStore.activeView.kind === 'tool-profile-form'}
        {#key viewStore.activeView.toolProfileId ?? '__new__'}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <ToolProfileForm
              toolProfileId={viewStore.activeView.toolProfileId}
              origin={viewStore.activeView.origin}
              onClose={() => viewStore.openChat()}
            />
          </div>
        {/key}
      {:else}
        <VirtualMessageList
          messages={chatStore.messages}
          streamPulse={chatStore.streamPulse}
          isLoading={chatStore.isLoading}
          {initialHydrationPending}
          pinToBottomToken={pinToBottomRequest}
        />
      {/if}

      <BackgroundActivityBar
        threads={backgroundActivity.threads}
        onSelect={async (threadId) => {
          backgroundActivity.markSeen(threadId)
          try {
            const thread = await getThread(threadId as any)
            viewStore.openChat()
            await chatStore.switchToThread(thread)
          } catch {
            // Thread may have been deleted — ignore
          }
        }}
      />

      <div class={viewStore.activeView.kind !== 'chat' ? 'pointer-events-none opacity-30' : ''}>
        <ChatComposer
          {commandItems}
          onPinToBottom={() => {
            pinToBottomRequest += 1
          }}
        />
      </div>

      <LightboxHost />
      <ResizeHandles />
    </div>
  {/if}
</div>
