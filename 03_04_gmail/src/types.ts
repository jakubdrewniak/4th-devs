import type { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: any) => Promise<unknown>;
}

export interface GmailAttachmentSummary {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailSearchItem {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  recipients: string[];
  receivedAt: string;
  isDraft: boolean;
  isRead: boolean;
  labels: string[];
  attachments: GmailAttachmentSummary[];
}

export interface GmailSearchResult {
  items: GmailSearchItem[];
  nextCursor: string | null;
}

export interface GmailReadMessage {
  messageId: string;
  sender: string;
  recipients: string[];
  receivedAt: string;
  isDraft: boolean;
  isRead: boolean;
  labels: string[];
  bodyText: string;
  attachments: GmailAttachmentSummary[];
}

export interface GmailReadResult {
  kind: 'message' | 'thread';
  threadId: string;
  subject: string;
  messages: GmailReadMessage[];
}

export interface GmailSendResult {
  status: 'sent' | 'drafted';
  mode: 'new' | 'reply' | 'forward';
  messageId: string | null;
  threadId: string | null;
  draftId: string | null;
  policy?: {
    enforcedDraft: boolean;
    blockedRecipients: string[];
    whitelist: string[];
  };
}

export interface GmailModifyResult {
  kind: 'message' | 'thread';
  id: string;
  appliedAction: string;
  labels: string[];
}

export interface GmailAttachmentResult {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentBase64: string;
}
