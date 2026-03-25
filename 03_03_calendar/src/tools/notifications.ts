import { listNotifications, pushNotification } from '../data/notifications.js';
import type { ToolDefinition } from '../types.js';

export const notificationTools: ToolDefinition[] = [
  {
    name: 'send_notification',
    description: 'Send a user notification. Used by the webhook phase.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification body text' },
        channel: {
          type: 'string',
          enum: ['push', 'sms', 'email'],
          description: 'Delivery channel (default push)',
        },
        event_id: { type: 'string', description: 'Optional related calendar event ID' },
      },
      required: ['title', 'message'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.title !== 'string' || args.title.trim().length === 0) {
        return { error: 'title is required and must be a non-empty string' };
      }
      if (typeof args.message !== 'string' || args.message.trim().length === 0) {
        return { error: 'message is required and must be a non-empty string' };
      }

      const channel =
        args.channel === 'sms' || args.channel === 'email' || args.channel === 'push'
          ? args.channel
          : 'push';

      const created = pushNotification({
        channel,
        title: args.title,
        message: args.message,
        eventId: typeof args.event_id === 'string' ? args.event_id : undefined,
      });

      return { sent: true, notification: created };
    },
  },
  {
    name: 'list_notifications',
    description: 'List all notifications sent so far.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: async () => ({
      total: listNotifications().length,
      notifications: listNotifications(),
    }),
  },
];
