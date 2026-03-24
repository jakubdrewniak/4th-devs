import { labels, emails } from '../data/mock-inbox.js';
import type { ToolDefinition } from '../types.js';

let labelCounter = 0;

export const labelTools: ToolDefinition[] = [
  {
    name: 'list_labels',
    description: 'List all labels for a given account (both system and user-created).',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account' },
      },
      required: ['account'],
      additionalProperties: false,
    },
    handler: async (args) => ({
      labels: labels.filter((l) => l.account === args.account),
    }),
  },

  {
    name: 'create_label',
    description: 'Create a new user label for a given account.',
    parameters: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email address of the account' },
        name: { type: 'string', description: 'Label display name' },
        color: { type: 'string', description: 'Hex color code (optional, e.g. "#ff6d01")' },
      },
      required: ['account', 'name'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const account = args.account as string;
      const name = args.name as string;

      const duplicate = labels.find(
        (l) => l.account === account && l.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) return { error: `Label "${name}" already exists`, label: duplicate };

      labelCounter++;
      const label = {
        id: `user-${Date.now()}-${labelCounter}`,
        account,
        name,
        type: 'user' as const,
        color: typeof args.color === 'string' ? args.color : undefined,
      };
      labels.push(label);
      return { label };
    },
  },

  {
    name: 'label_email',
    description: 'Add a label to an email.',
    parameters: {
      type: 'object',
      properties: {
        email_id: { type: 'string', description: 'ID of the email' },
        label_id: { type: 'string', description: 'ID of the label to add' },
      },
      required: ['email_id', 'label_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const email = emails.find((e) => e.id === args.email_id);
      if (!email) return { error: `Email not found: ${args.email_id}` };

      const label = labels.find((l) => l.id === args.label_id);
      if (!label) return { error: `Label not found: ${args.label_id}` };

      if (email.account !== label.account) {
        return { error: 'Label and email belong to different accounts' };
      }

      if (email.labelIds.includes(label.id)) {
        return { already_applied: true, email_id: email.id, label_id: label.id };
      }

      email.labelIds.push(label.id);
      return { success: true, email_id: email.id, label_id: label.id, label_name: label.name };
    },
  },

  {
    name: 'unlabel_email',
    description: 'Remove a label from an email.',
    parameters: {
      type: 'object',
      properties: {
        email_id: { type: 'string', description: 'ID of the email' },
        label_id: { type: 'string', description: 'ID of the label to remove' },
      },
      required: ['email_id', 'label_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const email = emails.find((e) => e.id === args.email_id);
      if (!email) return { error: `Email not found: ${args.email_id}` };

      const idx = email.labelIds.indexOf(args.label_id as string);
      if (idx === -1) return { not_applied: true, email_id: email.id, label_id: args.label_id };

      email.labelIds.splice(idx, 1);
      return { success: true, email_id: email.id, removed_label_id: args.label_id };
    },
  },
];
