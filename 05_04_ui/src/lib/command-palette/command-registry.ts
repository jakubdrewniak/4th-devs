import type { AppCommands } from '../commands/app-commands'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider } from './types'

export const createCommandsProvider = (appCommands: AppCommands): PaletteProvider => {
  const items = createCommandRegistry(appCommands)

  return {
    id: 'commands',
    mode: 'command',
    getItems: (query) => searchCommands(query, items),
    onSelect: (item) => {
      void item.run()
    },
  }
}

export const createCommandRegistry = (appCommands: AppCommands): CommandItem[] => [
  {
    id: 'chat.new-conversation',
    label: 'New Conversation',
    group: 'Chat',
    shortcutHint: '⌘⌥N',
    keywords: ['reset', 'clear', 'start', 'fresh'],
    enabled: () => appCommands.canStartNewConversation(),
    run: async () => {
      await appCommands.newConversation()
    },
  },
  {
    id: 'chat.upload-attachment',
    label: 'Add file or image',
    group: 'Chat',
    keywords: ['attach', 'attachment', 'upload', 'file', 'image', 'document'],
    surfaces: ['palette', 'slash'],
    enabled: () => appCommands.canPickAttachments(),
    run: () => {
      appCommands.pickAttachments()
    },
  },
  {
    id: 'chat.switch-conversation',
    label: 'Switch Conversation',
    group: 'Chat',
    shortcutHint: 'Cmd+Alt+O',
    keywords: ['thread', 'history', 'conversations', 'recent', 'switch'],
    enabled: () => appCommands.canOpenConversationPicker(),
    run: () => {
      appCommands.openConversationPicker()
    },
  },
  {
    id: 'chat.previous-conversation',
    label: 'Previous Conversation',
    group: 'Chat',
    shortcutHint: 'Cmd/Ctrl+[',
    keywords: ['previous', 'back', 'thread', 'history', 'conversation'],
    enabled: () => appCommands.canGoToPreviousConversation(),
    run: async () => {
      await appCommands.goToPreviousConversation()
    },
  },
  {
    id: 'chat.next-conversation',
    label: 'Next Conversation',
    group: 'Chat',
    shortcutHint: 'Cmd/Ctrl+]',
    keywords: ['next', 'forward', 'thread', 'history', 'conversation'],
    enabled: () => appCommands.canGoToNextConversation(),
    run: async () => {
      await appCommands.goToNextConversation()
    },
  },
  {
    id: 'chat.rename-conversation',
    label: 'Rename Conversation',
    group: 'Chat',
    keywords: ['rename', 'title'],
    enabled: () => appCommands.canRenameConversation(),
    run: async () => {
      await appCommands.renameConversation()
    },
  },
  {
    id: 'chat.delete-conversation',
    label: 'Delete Conversation',
    group: 'Chat',
    keywords: ['delete', 'remove'],
    enabled: () => appCommands.canDeleteConversation(),
    run: async () => {
      await appCommands.deleteConversation()
    },
  },
  {
    id: 'agents.manage',
    label: 'Manage Agents',
    group: 'Agents',
    keywords: ['agents', 'manage', 'edit', 'configure', 'browse'],
    enabled: () => appCommands.canOpenAgentPanel(),
    run: () => {
      appCommands.openAgentPanel()
    },
  },
  {
    id: 'agents.new',
    label: 'New Agent',
    group: 'Agents',
    keywords: ['create', 'new', 'agent'],
    enabled: () => appCommands.canOpenAgentPanel(),
    run: () => {
      appCommands.openNewAgent()
    },
  },
  {
    id: 'mcp.connect',
    label: 'Connect MCP',
    group: 'Integrations',
    keywords: ['model context protocol', 'server', 'tool', 'stdio', 'streamable', 'http'],
    enabled: () => appCommands.canOpenConnectMcp(),
    run: () => {
      appCommands.openConnectMcp()
    },
  },
  {
    id: 'mcp.manage',
    label: 'Manage MCP Servers',
    group: 'Integrations',
    keywords: ['model context protocol', 'server', 'edit', 'refresh', 'connections', 'tools'],
    enabled: () => appCommands.canOpenManageMcp(),
    run: () => {
      appCommands.openManageMcp()
    },
  },
  {
    id: 'mcp.tool-profiles',
    label: 'Manage Tool Profiles',
    group: 'Integrations',
    keywords: ['tool access', 'profiles', 'mcp', 'permissions', 'grants'],
    enabled: () => appCommands.canOpenManageToolProfiles(),
    run: () => {
      appCommands.openManageToolProfiles()
    },
  },
  {
    id: 'workspace.switch',
    label: 'Switch Workspace',
    group: 'Workspace',
    keywords: ['workspace', 'tenant', 'account', 'organization'],
    surfaces: ['palette'],
    enabled: () => appCommands.canOpenWorkspacePicker(),
    run: () => {
      appCommands.openWorkspacePicker()
    },
  },
  {
    id: 'settings.cycle-model',
    label: 'Cycle Model',
    group: 'Settings',
    shortcutHint: '⌘⌥M',
    keywords: ['switch', 'model', 'gpt', 'change'],
    enabled: () => appCommands.canCycleModel(),
    run: () => {
      appCommands.cycleModel()
    },
  },
  {
    id: 'settings.cycle-reasoning',
    label: 'Cycle Reasoning Mode',
    group: 'Settings',
    keywords: ['reasoning', 'effort', 'thinking'],
    enabled: () => appCommands.canCycleReasoning(),
    run: () => {
      appCommands.cycleReasoning()
    },
  },
  {
    id: 'settings.cycle-theme',
    label: 'Cycle Theme',
    group: 'Settings',
    keywords: ['appearance', 'light', 'dark', 'system'],
    surfaces: ['palette', 'slash'],
    enabled: () => appCommands.canCycleTheme(),
    run: () => {
      appCommands.cycleTheme()
    },
  },
  {
    id: 'settings.cycle-typewriter',
    label: 'Cycle Typewriter Speed',
    group: 'Settings',
    shortcutHint: '⌘⌥T',
    keywords: ['animation', 'speed', 'typewriter', 'slow', 'fast'],
    enabled: () => true,
    run: () => {
      appCommands.cycleTypewriter()
    },
  },
  {
    id: 'account.sign-out',
    label: 'Sign Out',
    group: 'Account',
    keywords: ['logout', 'log out', 'sign out', 'session'],
    surfaces: ['palette'],
    enabled: () => appCommands.canSignOut(),
    run: async () => {
      await appCommands.signOut()
    },
  },
]
