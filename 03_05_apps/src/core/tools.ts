import type { AgentContext, Tool } from '../types.js'
import { readListsState, summarizeLists, writeListsState } from './list-files.js'
import { openBrowser } from './browser.js'
import { logger } from '../logger.js'

export const createTools = (ctx: AgentContext): Tool[] => [
  {
    definition: {
      type: 'function',
      name: 'get_lists',
      description: 'Read current todo and shopping lists from disk.',
      parameters: { type: 'object', properties: {}, required: [] },
      strict: false,
    },
    handler: async () => {
      const state = await readListsState(ctx)
      return JSON.stringify(state, null, 2)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'save_lists',
      description:
        'Persist updated todo and/or shopping lists. Provide full replacement arrays for the lists you want to update; omitted lists stay unchanged.',
      parameters: {
        type: 'object',
        properties: {
          todo: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, done: { type: 'boolean' } },
              required: ['text'],
            },
            description: 'Full todo list to save.',
          },
          shopping: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, done: { type: 'boolean' } },
              required: ['text'],
            },
            description: 'Full shopping list to save.',
          },
        },
        required: [],
      },
      strict: false,
    },
    handler: async (args) => {
      const current = await readListsState(ctx)
      const saved = await writeListsState(ctx, {
        todo: Array.isArray(args.todo) ? args.todo : current.todo,
        shopping: Array.isArray(args.shopping) ? args.shopping : current.shopping,
      })
      return `Saved. ${summarizeLists(saved)}`
    },
  },
  {
    definition: {
      type: 'function',
      name: 'open_list_manager',
      description: 'Open the browser UI so the user can interactively manage their lists.',
      parameters: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            enum: ['todo', 'shopping'],
            description: 'Which list tab to focus.',
          },
        },
        required: [],
      },
      strict: false,
    },
    handler: async (args) => {
      const focus = args.focus === 'shopping' ? 'shopping' : 'todo'
      const url = new URL(ctx.uiUrl)
      url.searchParams.set('focus', focus)
      openBrowser(url.toString())
      logger.info('manager.opened', { focus, url: url.toString() })
      return `Opened browser at ${url} (${focus} tab).`
    },
  },
]
