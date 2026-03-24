import { knowledgeBase } from '../data/knowledge-base.js';
import { knowledgeAccessLog } from '../knowledge/access-log.js';
import { assertAccountAccess } from '../knowledge/access-lock.js';
import type { ToolDefinition } from '../types.js';

export const knowledgeTools: ToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge base. Returns entries matching the query. ' +
      'Automatically includes shared entries plus entries scoped to the given account. ' +
      'Entries belonging to other accounts are not accessible.',
    parameters: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Email address of the account — used to scope results (shared + account-specific)',
        },
        query: {
          type: 'string',
          description: 'Search query (case-insensitive, matches against title, category, and content)',
        },
      },
      required: ['account', 'query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const account = args.account as string;
      assertAccountAccess(account);
      const q = (args.query as string).toLowerCase();

      const allMatching = knowledgeBase.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q),
      );

      const visible = allMatching.filter(
        (e) => e.account === 'shared' || e.account === account,
      );
      const blocked = allMatching.filter(
        (e) => e.account !== 'shared' && e.account !== account,
      );

      knowledgeAccessLog.push({
        tool: 'search_knowledge',
        account,
        query: args.query as string,
        returned: visible.map((e) => ({ id: e.id, title: e.title, scope: e.account })),
        blocked: blocked.map((e) => ({ id: e.id, title: e.title, owner: e.account })),
      });

      return {
        total: visible.length,
        filtered_by_isolation: blocked.length,
        entries: visible.map((e) => ({
          id: e.id, account: e.account, title: e.title,
          category: e.category, content: e.content, updatedAt: e.updatedAt,
        })),
        ...(blocked.length > 0 && {
          isolation_notice: `${blocked.length} entries matched but belong to other accounts and were filtered out.`,
        }),
      };
    },
  },

  {
    name: 'get_knowledge_entry',
    description:
      'Get a single knowledge base entry by ID. Requires the account context — ' +
      'only shared entries and entries belonging to the given account are accessible.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account requesting access' },
        entry_id: { type: 'string', description: 'ID of the knowledge base entry' },
      },
      required: ['account', 'entry_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const account = args.account as string;
      assertAccountAccess(account);
      const entry = knowledgeBase.find((e) => e.id === args.entry_id);

      if (!entry) {
        knowledgeAccessLog.push({ tool: 'get_knowledge_entry', account, returned: [], blocked: [] });
        return { error: `Entry not found: ${args.entry_id}` };
      }

      if (entry.account !== 'shared' && entry.account !== account) {
        knowledgeAccessLog.push({
          tool: 'get_knowledge_entry', account, returned: [],
          blocked: [{ id: entry.id, title: entry.title, owner: entry.account }],
        });
        return {
          error: 'ACCESS_DENIED',
          message: `Entry "${entry.title}" belongs to account ${entry.account} and cannot be accessed from ${account}. Account data isolation is enforced.`,
        };
      }

      knowledgeAccessLog.push({
        tool: 'get_knowledge_entry', account,
        returned: [{ id: entry.id, title: entry.title, scope: entry.account }],
        blocked: [],
      });
      return entry;
    },
  },

  {
    name: 'list_knowledge',
    description:
      'List all knowledge base entries visible to an account (shared + account-scoped). Returns titles and categories, not full content.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account' },
        category: { type: 'string', description: 'Filter by category (optional)' },
      },
      required: ['account'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const account = args.account as string;
      assertAccountAccess(account);

      let visible = knowledgeBase.filter(
        (e) => e.account === 'shared' || e.account === account,
      );
      const hiddenCount = knowledgeBase.filter(
        (e) => e.account !== 'shared' && e.account !== account,
      ).length;

      if (typeof args.category === 'string') {
        visible = visible.filter((e) => e.category === args.category);
      }

      knowledgeAccessLog.push({
        tool: 'list_knowledge', account,
        returned: visible.map((e) => ({ id: e.id, title: e.title, scope: e.account })),
        blocked: knowledgeBase
          .filter((e) => e.account !== 'shared' && e.account !== account)
          .map((e) => ({ id: e.id, title: e.title, owner: e.account })),
      });

      return {
        total: visible.length,
        filtered_by_isolation: hiddenCount,
        entries: visible.map((e) => ({
          id: e.id, account: e.account, title: e.title, category: e.category, updatedAt: e.updatedAt,
        })),
      };
    },
  },
];
