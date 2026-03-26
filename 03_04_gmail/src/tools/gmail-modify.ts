import { z } from 'zod';
import { withHint } from '../hints/index.js';
import {
  buildModifyHint,
  deriveMailboxState,
} from '../hints/tool-hints.js';
import { modifyMailboxItem } from '../gmail/client.js';
import type { ToolDefinition } from '../types.js';

const ACTIONS = [
  'markRead',
  'markUnread',
  'archive',
  'unarchive',
  'trash',
  'untrash',
  'addLabel',
  'removeLabel',
] as const;

const LABEL_ACTIONS: ReadonlySet<string> = new Set<string>([
  'addLabel',
  'removeLabel',
]);

export const modifyInputSchema = z
  .object({
    kind: z
      .enum(['message', 'thread'])
      .describe('Target type to update: a single message or an entire thread.'),
    id: z
      .string()
      .min(1)
      .describe('Target messageId or threadId, depending on kind.'),
    action: z
      .enum(ACTIONS)
      .describe('Mailbox action to apply: read/unread, archive/unarchive, trash/untrash, addLabel/removeLabel.'),
    label: z
      .string()
      .describe('Label name or ID to use with addLabel/removeLabel actions only.')
      .optional(),
  })
  .refine(
    (d) =>
      !LABEL_ACTIONS.has(d.action) ||
      (d.label && d.label.trim().length > 0),
    { message: 'label is required when action is addLabel or removeLabel.' },
  )
  .refine((d) => LABEL_ACTIONS.has(d.action) || !d.label, {
    message: 'label is only allowed for addLabel or removeLabel actions.',
  });

type Input = z.infer<typeof modifyInputSchema>;

export const gmailModifyTool: ToolDefinition = {
  name: 'gmail_modify',
  description:
    'Modify a message or thread: read/unread, archive, trash, and label operations.',
  schema: modifyInputSchema,
  handler: async (args: Input) => {
    const id = args.id.trim();
    const label = args.label?.trim() || undefined;
    const result = await modifyMailboxItem({
      kind: args.kind,
      id,
      action: args.action,
      label,
    });
    const updatedState = deriveMailboxState(result.labels);
    const data = {
      ...result,
      updatedState,
      applied: {
        action: args.action,
        ...(label ? { label } : {}),
      },
    };

    return withHint(
      data,
      buildModifyHint({
        kind: result.kind,
        id,
        action: args.action,
        label,
        labels: result.labels,
      }),
    );
  },
};
