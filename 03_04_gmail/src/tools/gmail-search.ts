import { z } from 'zod';
import { withHint } from '../hints/index.js';
import { buildSearchHint } from '../hints/tool-hints.js';
import { searchMessages } from '../gmail/client.js';
import type { ToolDefinition, GmailSearchItem } from '../types.js';

export const searchInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Gmail query syntax. Example filters: "from:person+demo@example.test is:unread", "is:draft", "has:attachment subject:invoice". Leave empty to list recent messages.',
    )
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Maximum number of messages to return in this page. Default: 20. Allowed range: 1-50.')
    .optional(),
  cursor: z
    .string()
    .describe('Pagination token from a previous gmail_search response (data.nextCursor). Use only to fetch the next page.')
    .optional(),
  details: z
    .boolean()
    .describe('When true, include richer metadata (recipients, labels, attachment summaries). Default: false for compact results.')
    .optional(),
});

type Input = z.infer<typeof searchInputSchema>;

const toSummary = (item: GmailSearchItem) => ({
  messageId: item.messageId,
  threadId: item.threadId,
  subject: item.subject,
  sender: item.sender,
  receivedAt: item.receivedAt,
  isDraft: item.isDraft,
  isRead: item.isRead,
});

export const gmailSearchTool: ToolDefinition = {
  name: 'gmail_search',
  description:
    'Search Gmail messages using Gmail query syntax and return compact message metadata. Set details=true for recipients, labels, and attachments.',
  schema: searchInputSchema,
  handler: async (args: Input) => {
    const query = (args.query ?? '').trim();
    const result = await searchMessages({
      query,
      limit: args.limit ?? 20,
      cursor: args.cursor,
    });

    const items = args.details ? result.items : result.items.map(toSummary);
    const data = {
      items,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };

    return withHint(
      data,
      buildSearchHint({
        query,
        count: items.length,
        nextCursor: result.nextCursor ?? undefined,
        firstMessageId: result.items[0]?.messageId,
      }),
    );
  },
};
