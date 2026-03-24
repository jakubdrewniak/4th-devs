import { emails } from '../data/mock-inbox.js';
import type { ToolDefinition } from '../types.js';

export const emailTools: ToolDefinition[] = [
  {
    name: 'list_emails',
    description:
      'List emails from a given account. Supports filtering by label, read status, and pagination.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account to query' },
        label: { type: 'string', description: 'Filter by label ID (optional)' },
        is_read: { type: 'boolean', description: 'Filter by read status (optional)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Skip N results (default 0)' },
      },
      required: ['account'],
      additionalProperties: false,
    },
    handler: async (args) => {
      let result = emails.filter((e) => e.account === args.account);

      if (typeof args.label === 'string') {
        result = result.filter((e) => e.labelIds.includes(args.label as string));
      }
      if (typeof args.is_read === 'boolean') {
        result = result.filter((e) => e.isRead === args.is_read);
      }

      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const limit = typeof args.limit === 'number' ? args.limit : 20;

      return {
        total: result.length,
        emails: result.slice(offset, offset + limit).map((e) => ({
          id: e.id,
          threadId: e.threadId,
          from: e.from,
          to: e.to,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date,
          labelIds: e.labelIds,
          isRead: e.isRead,
          hasAttachments: e.hasAttachments,
        })),
      };
    },
  },

  {
    name: 'get_email',
    description: 'Get full email content by ID, including the body.',
    parameters: {
      type: 'object',
      properties: {
        email_id: { type: 'string', description: 'ID of the email to retrieve' },
      },
      required: ['email_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const email = emails.find((e) => e.id === args.email_id);
      if (!email) return { error: `Email not found: ${args.email_id}` };
      return email;
    },
  },

  {
    name: 'search_emails',
    description:
      'Search emails by query string across subject and body. Scoped to a single account.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account to search' },
        query: { type: 'string', description: 'Search query (case-insensitive substring match)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['account', 'query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const q = (args.query as string).toLowerCase();
      const results = emails
        .filter(
          (e) =>
            e.account === args.account &&
            (e.subject.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, typeof args.limit === 'number' ? args.limit : 10);

      return { total: results.length, emails: results };
    },
  },

  {
    name: 'list_threads',
    description:
      'List email threads for a given account. Groups messages by threadId, returns summaries.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account' },
      },
      required: ['account'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const accountEmails = emails.filter((e) => e.account === args.account);
      const threadMap = new Map<string, typeof accountEmails>();

      for (const email of accountEmails) {
        const existing = threadMap.get(email.threadId) ?? [];
        existing.push(email);
        threadMap.set(email.threadId, existing);
      }

      const threads = [...threadMap.entries()]
        .map(([threadId, msgs]) => {
          const sorted = msgs.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          const allLabels = [...new Set(sorted.flatMap((m) => m.labelIds))];
          return {
            threadId,
            subject: sorted[0].subject.replace(/^Re:\s*/i, ''),
            messageCount: sorted.length,
            participants: [...new Set(sorted.flatMap((m) => [m.from, ...m.to]))],
            lastMessageDate: sorted[sorted.length - 1].date,
            labelIds: allLabels,
            hasUnread: sorted.some((m) => !m.isRead),
          };
        })
        .sort((a, b) => new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime());

      return { total: threads.length, threads };
    },
  },
];
