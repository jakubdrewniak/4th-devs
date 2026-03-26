import { z } from 'zod';
import { withHint } from '../hints/index.js';
import { buildSendHint } from '../hints/tool-hints.js';
import { sendMessage } from '../gmail/client.js';
import type { ToolDefinition } from '../types.js';

const nonEmptyStrings = (arr: string[]): string[] =>
  arr.map((s) => s.trim()).filter(Boolean);

export const sendInputSchema = z
  .object({
    mode: z
      .enum(['new', 'reply', 'forward'])
      .describe('Compose mode. "new" creates a new thread, "reply" replies to an existing message, "forward" forwards an existing message.'),
    to: z
      .array(z.string())
      .describe(
        'Primary recipient email addresses. Required for mode="new" and mode="forward". Optional for mode="reply" (can be inferred). In demos/tests, use placeholders like "alice+demo@example.test".',
      )
      .optional(),
    cc: z
      .array(z.string())
      .describe('Optional CC email addresses. In demos/tests, use placeholders like "team+demo@example.test".')
      .optional(),
    bcc: z
      .array(z.string())
      .describe('Optional BCC email addresses. In demos/tests, use placeholders like "audit+demo@example.test".')
      .optional(),
    subject: z
      .string()
      .describe('Email subject. Required for mode="new". Optional for reply/forward (tool can derive a prefixed subject).')
      .optional(),
    bodyText: z
      .string()
      .min(1)
      .describe('Plain-text email body to send or draft. Required and must be non-empty.'),
    replyToMessageId: z
      .string()
      .describe('Source message ID to reply to. Required when mode="reply".')
      .optional(),
    forwardMessageId: z
      .string()
      .describe('Source message ID to forward. Required when mode="forward".')
      .optional(),
    saveAsDraft: z
      .boolean()
      .describe('When true, always create a draft instead of sending immediately. Default: false.')
      .optional(),
  })
  .refine((d) => !(d.replyToMessageId && d.forwardMessageId), {
    message: 'replyToMessageId and forwardMessageId are mutually exclusive.',
  })
  .refine((d) => d.mode !== 'new' || ((d.to ?? []).length > 0 && d.subject), {
    message: 'to and subject are required when mode="new".',
  })
  .refine((d) => d.mode !== 'reply' || d.replyToMessageId, {
    message: 'replyToMessageId is required when mode="reply".',
  })
  .refine(
    (d) =>
      d.mode !== 'forward' ||
      (d.forwardMessageId && (d.to ?? []).length > 0),
    { message: 'forwardMessageId and to are required when mode="forward".' },
  );

type Input = z.infer<typeof sendInputSchema>;

export const gmailSendTool: ToolDefinition = {
  name: 'gmail_send',
  description:
    'Send a new email, reply, or forward. Can send immediately or save as draft.',
  schema: sendInputSchema,
  handler: async (args: Input) => {
    const result = await sendMessage({
      mode: args.mode,
      to: nonEmptyStrings(args.to ?? []),
      cc: nonEmptyStrings(args.cc ?? []),
      bcc: nonEmptyStrings(args.bcc ?? []),
      subject: args.subject?.trim() || undefined,
      bodyText: args.bodyText.trim(),
      replyToMessageId: args.replyToMessageId?.trim() || undefined,
      forwardMessageId: args.forwardMessageId?.trim() || undefined,
      saveAsDraft: args.saveAsDraft ?? false,
    });

    return withHint(result, buildSendHint(result));
  },
};
