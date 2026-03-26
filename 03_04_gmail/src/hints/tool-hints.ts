import type {
  GmailReadMessage,
  GmailSendResult,
} from '../types.js';
import {
  createHint,
  proposeAction,
  type ToolHint,
} from './index.js';

const shortQuery = (query: string): string =>
  query.trim().replace(/\s+/g, ' ');

const broadenQuery = (query: string): string => {
  const stripped = query
    .replace(/\b(from|to|subject|is|in|has|category):[^\s)]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped;
};

const findFirstAttachment = (
  messages: GmailReadMessage[],
): { messageId: string; attachmentId: string; filename: string } | null => {
  for (const message of messages) {
    for (const attachment of message.attachments) {
      return {
        messageId: message.messageId,
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
      };
    }
  }
  return null;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const buildSearchHint = (params: {
  query: string;
  count: number;
  nextCursor?: string;
  firstMessageId?: string;
}): ToolHint => {
  const query = shortQuery(params.query);

  if (params.count === 0) {
    const expandedQuery = query.length > 0 ? broadenQuery(query) : '';
    const nextActions =
      expandedQuery.length > 0 && expandedQuery !== query
        ? [
            proposeAction(
              'gmail_search',
              'A broader query may return results.',
              { query: expandedQuery, limit: 20 },
              0.63,
            ),
          ]
        : [];

    return createHint({
      status: 'empty',
      reasonCode: 'NO_RESULTS',
      summary:
        query.length > 0
          ? `No messages found for query "${query}".`
          : 'No messages found for the default listing.',
      nextActions,
    });
  }

  const nextActions = [];
  if (params.firstMessageId) {
    nextActions.push(
      proposeAction(
        'gmail_read',
        'Load full content before quoting details to the user.',
        { id: params.firstMessageId },
        0.76,
      ),
    );
  }
  if (params.nextCursor) {
    nextActions.push(
      proposeAction(
        'gmail_search',
        'Load the next page if the user asked for more results.',
        {
          ...(query.length > 0 ? { query } : {}),
          cursor: params.nextCursor,
        },
        0.68,
      ),
    );
  }

  return createHint({
    status: params.nextCursor ? 'partial' : 'success',
    reasonCode: 'OK',
    summary: params.nextCursor
      ? `Found ${params.count} message(s) on this page. More results are available.`
      : `Found ${params.count} message(s).`,
    nextActions,
  });
};

export const buildReadHint = (params: {
  id: string;
  kind: 'message' | 'thread';
  subject: string;
  details: boolean;
  messages: GmailReadMessage[];
}): ToolHint => {
  const firstAttachment = findFirstAttachment(params.messages);
  const nextActions = [];

  if (!params.details) {
    nextActions.push(
      proposeAction(
        'gmail_read',
        'Use details=true when recipients, labels, or attachment metadata are needed.',
        { id: params.id, details: true },
        0.67,
      ),
    );
  }

  if (firstAttachment) {
    nextActions.push(
      proposeAction(
        'gmail_attachment',
        `Download attachment "${firstAttachment.filename}" if the user needs file content.`,
        {
          messageId: firstAttachment.messageId,
          attachmentId: firstAttachment.attachmentId,
        },
        0.72,
      ),
    );
  }

  return createHint({
    status: 'success',
    reasonCode: 'OK',
    summary:
      params.kind === 'thread'
        ? `Loaded thread "${params.subject}" with ${params.messages.length} message(s).`
        : `Loaded message "${params.subject}".`,
    nextActions,
  });
};

export const buildSendHint = (result: GmailSendResult): ToolHint => {
  const nextActions = [];
  if (result.messageId) {
    nextActions.push(
      proposeAction(
        'gmail_read',
        'Open the sent or drafted message to verify final content.',
        { id: result.messageId },
        0.58,
      ),
    );
  }

  if (result.status === 'drafted' && result.policy?.enforcedDraft) {
    const blockedRecipients = result.policy.blockedRecipients.join(', ');
    return createHint({
      status: 'partial',
      reasonCode: 'POLICY_BLOCKED',
      summary:
        blockedRecipients.length > 0
          ? `Saved as draft because recipients are outside whitelist: ${blockedRecipients}.`
          : 'Saved as draft because send policy blocked immediate delivery.',
      nextActions,
    });
  }

  if (result.status === 'drafted') {
    return createHint({
      status: 'success',
      reasonCode: 'OK',
      summary: `Draft created successfully${result.draftId ? ` (draftId=${result.draftId}).` : '.'}`,
      nextActions,
    });
  }

  return createHint({
    status: 'success',
    reasonCode: 'OK',
    summary: `Message sent successfully${result.messageId ? ` (messageId=${result.messageId}).` : '.'}`,
    nextActions,
  });
};

export const deriveMailboxState = (labels: string[]) => {
  const lowered = new Set(labels.map((label) => label.toLowerCase()));
  return {
    labels,
    isRead: !lowered.has('unread'),
    inInbox: lowered.has('inbox'),
    inTrash: lowered.has('trash'),
    isDraft: lowered.has('draft'),
  };
};

export const buildModifyHint = (params: {
  kind: 'message' | 'thread';
  id: string;
  action: string;
  label?: string;
  labels: string[];
}): ToolHint => {
  const state = deriveMailboxState(params.labels);
  const labelPart = params.label ? ` using label "${params.label}"` : '';
  const nextActions = [
    proposeAction(
      'gmail_read',
      'Re-open the updated target if you need full message content after this state change.',
      { id: params.id, details: true },
      0.55,
    ),
  ];

  return createHint({
    status: 'success',
    reasonCode: 'OK',
    summary: `${params.kind} "${params.id}" updated with action "${params.action}"${labelPart}. isRead=${state.isRead}, inInbox=${state.inInbox}, inTrash=${state.inTrash}, isDraft=${state.isDraft}.`,
    nextActions,
  });
};

export const buildAttachmentHint = (params: {
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}): ToolHint =>
  createHint({
    status: 'success',
    reasonCode: 'OK',
    summary: `Attachment "${params.filename}" (${formatBytes(params.size)}, ${params.mimeType}) uploaded to a public URL.`,
    nextActions: [
      proposeAction(
        'gmail_read',
        'Re-open the source message if you need additional context around this attachment.',
        { id: params.messageId, details: true },
        0.52,
      ),
    ],
    diagnostics: {
      scope: 'tool',
      rawMessage: params.url,
    },
  });
