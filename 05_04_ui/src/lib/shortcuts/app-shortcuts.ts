import type { AppCommands } from '../commands/app-commands'
import type { PaletteStore } from '../command-palette/palette-store.svelte'
import type { PaletteProvider } from '../command-palette/types'
import type { ShortcutDefinition } from './types'

export interface AppShortcutDeps {
  appCommands: AppCommands
  paletteStore: PaletteStore
  commandsProvider: PaletteProvider
}

export const createAppShortcutDefinitions = ({
  appCommands,
  paletteStore,
  commandsProvider,
}: AppShortcutDeps): ShortcutDefinition[] => [
  {
    id: 'palette.toggle',
    description: 'Toggle command palette',
    keys: ['Mod+K'],
    scope: 'global',
    allowInEditable: true,
    run: () => {
      paletteStore.openWith(commandsProvider)
    },
  },
  {
    id: 'settings.cycle-model',
    description: 'Cycle the active model',
    keys: ['Mod+Alt+M'],
    scope: 'global',
    allowInEditable: true,
    when: () => appCommands.canCycleModel(),
    run: () => {
      appCommands.cycleModel()
    },
  },
  {
    id: 'chat.open-conversation-picker',
    description: 'Open the conversation picker',
    keys: ['Mod+Alt+O'],
    scope: 'global',
    allowInEditable: true,
    when: () => appCommands.canOpenConversationPicker(),
    run: () => {
      appCommands.openConversationPicker()
    },
  },
  {
    id: 'chat.previous-conversation',
    description: 'Switch to the previous conversation',
    keys: ['Mod+['],
    scope: 'global',
    allowInEditable: true,
    when: () => appCommands.canGoToPreviousConversation(),
    run: async () => {
      await appCommands.goToPreviousConversation()
    },
  },
  {
    id: 'chat.next-conversation',
    description: 'Switch to the next conversation',
    keys: ['Mod+]'],
    scope: 'global',
    allowInEditable: true,
    when: () => appCommands.canGoToNextConversation(),
    run: async () => {
      await appCommands.goToNextConversation()
    },
  },
  {
    id: 'settings.cycle-typewriter',
    description: 'Cycle the typewriter speed',
    keys: ['Mod+Alt+T'],
    scope: 'global',
    allowInEditable: true,
    run: () => {
      appCommands.cycleTypewriter()
    },
  },
  {
    id: 'chat.new-conversation',
    description: 'Start a new conversation',
    keys: ['Mod+Alt+N'],
    scope: 'global',
    allowInEditable: true,
    when: () => appCommands.canStartNewConversation(),
    run: async () => {
      await appCommands.newConversation()
    },
  },
]
