import { z } from 'zod';
import { withHint } from '../hints/index.js';
import { buildReadHint } from '../hints/tool-hints.js';
import { readMessages } from '../gmail/client.js';
import type { ToolDefinition, GmailReadMessage } from '../types.js';

export const readInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      'Message ID or thread ID returned by gmail_search. The tool auto-detects whether this ID is a message or a thread.',
    ),
  details: z
    .boolean()
    .describe('When true, include recipients, labels, and attachment metadata for each message. Default: false.')
    .optional(),
});

type Input = z.infer<typeof readInputSchema>;

const toSummary = (msg: GmailReadMessage) => ({
  messageId: msg.messageId,
  sender: msg.sender,
  receivedAt: msg.receivedAt,
  isDraft: msg.isDraft,
  isRead: msg.isRead,
  bodyText: msg.bodyText,
});

export const gmailReadTool: ToolDefinition = {
  name: 'gmail_read',
  description:
    'Read a single Gmail message or full thread by ID (auto-detects message vs thread). Set details=true for recipients, labels, and attachments.',
  schema: readInputSchema,
  handler: async (args: Input) => {
    const id = args.id.trim();
    const result = await readMessages({ id });

    const messages = args.details
      ? result.messages
      : result.messages.map(toSummary);
    const data = {
      kind: result.kind,
      threadId: result.threadId,
      subject: result.subject,
      messages,
    };

    return withHint(
      data,
      buildReadHint({
        id,
        kind: result.kind,
        subject: result.subject,
        details: args.details ?? false,
        messages: result.messages,
      }),
    );
  },
};
