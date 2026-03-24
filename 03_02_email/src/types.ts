import type { ContactType } from './data/contacts.js';

export interface Email {
  id: string;
  threadId: string;
  account: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  labelIds: string[];
  isRead: boolean;
  hasAttachments: boolean;
}

export interface Thread {
  id: string;
  account: string;
  subject: string;
  messages: Email[];
  labelIds: string[];
  lastMessageDate: string;
}

export interface Label {
  id: string;
  account: string;
  name: string;
  type: 'system' | 'user';
  color?: string;
}

export interface Draft {
  id: string;
  account: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  createdAt: string;
}

export interface Account {
  email: string;
  name: string;
  projectName: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ReplyPlan {
  emailId: string;
  account: string;
  recipientEmail: string;
  contactType: ContactType;
  reason: string;
  categories: string[];
}

export interface DraftSessionResult {
  plan: ReplyPlan;
  draftId: string;
  kbEntriesLoaded: { id: string; title: string; category: string }[];
  kbEntriesBlocked: { title: string; category: string; reason: string }[];
  draftBody: string;
}
