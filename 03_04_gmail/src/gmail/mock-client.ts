import { GMAIL_SEND_WHITELIST } from '../config.js';
import type {
  GmailAttachmentResult,
  GmailAttachmentSummary,
  GmailModifyResult,
  GmailReadMessage,
  GmailReadResult,
  GmailSearchItem,
  GmailSearchResult,
  GmailSendResult,
} from '../types.js';

interface SearchParams {
  query: string;
  limit: number;
  cursor?: string;
}

interface ReadParams {
  id: string;
}

interface SendParams {
  mode: 'new' | 'reply' | 'forward';
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  bodyText: string;
  replyToMessageId?: string;
  forwardMessageId?: string;
  saveAsDraft: boolean;
}

type ModifyAction =
  | 'markRead'
  | 'markUnread'
  | 'archive'
  | 'unarchive'
  | 'trash'
  | 'untrash'
  | 'addLabel'
  | 'removeLabel';

interface ModifyParams {
  kind: 'message' | 'thread';
  id: string;
  action: ModifyAction;
  label?: string;
}

interface AttachmentParams {
  messageId: string;
  attachmentId: string;
}

interface MockAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  size: number;
}

interface MockMessage {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  recipients: string[];
  receivedAt: string;
  labelIds: string[];
  bodyText: string;
  attachments: MockAttachment[];
}

interface MockState {
  messages: Map<string, MockMessage>;
  draftCounter: number;
  sentCounter: number;
  threadCounter: number;
}

interface ParsedQuery {
  from: string[];
  to: string[];
  isFlags: string[];
  inFolders: string[];
  categories: string[];
  hasAttachment: boolean;
  subjectAny: string[];
  newerThanDays?: number;
  olderThanDays?: number;
  keywords: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MOCK_OWNER_EMAIL = 'owner@company.com';
const MOCK_DEFAULT_SEND_WHITELIST = [
  'tom@company.com',
  'anna@company.com',
  'accounting@company.com',
  'client@acme.com',
];

const MOCK_LABELS = new Map<string, string>([
  ['INBOX', 'INBOX'],
  ['UNREAD', 'UNREAD'],
  ['SENT', 'SENT'],
  ['DRAFT', 'DRAFT'],
  ['TRASH', 'TRASH'],
  ['IMPORTANT', 'IMPORTANT'],
  ['CATEGORY_PROMOTIONS', 'CATEGORY_PROMOTIONS'],
  ['STARRED', 'STARRED'],
  ['URGENT', 'URGENT'],
]);

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'did',
  'do',
  'email',
  'emails',
  'find',
  'for',
  'from',
  'full',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'latest',
  'last',
  'me',
  'message',
  'messages',
  'most',
  'my',
  'of',
  'on',
  'one',
  'open',
  'recent',
  'show',
  'that',
  'the',
  'to',
  'up',
  'what',
  'where',
  'with',
]);

const uniqueStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const normalizeLabelName = (label: string): string => {
  if (label.startsWith('CATEGORY_')) return label.slice('CATEGORY_'.length).toLowerCase();
  if (/^[A-Z_]+$/.test(label)) return label.toLowerCase();
  return label;
};

const normalizeRecipientEmail = (recipient: string): string => {
  const trimmed = recipient.trim().toLowerCase();
  if (!trimmed) return '';

  const angleMatch = trimmed.match(/<\s*([^<>\s@]+@[^<>\s@]+)\s*>/);
  if (angleMatch?.[1]) return angleMatch[1];

  const directMatch = trimmed.match(
    /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+)/i,
  );
  if (directMatch?.[1]) return directMatch[1].toLowerCase();

  return '';
};

const daysAgo = (days: number, hour = 9): string =>
  new Date(Date.now() - days * DAY_MS + hour * 60 * 60 * 1000).toISOString();

const toBase64 = (value: string): string => Buffer.from(value, 'utf-8').toString('base64');

const attachment = (
  attachmentId: string,
  filename: string,
  mimeType: string,
  contentText: string,
): MockAttachment => {
  const contentBase64 = toBase64(contentText);
  return {
    attachmentId,
    filename,
    mimeType,
    contentBase64,
    size: Buffer.from(contentText, 'utf-8').byteLength,
  };
};

const makeInitialMessages = (): MockMessage[] => {
  const attDemo100 = attachment(
    'att_demo_100',
    'agenda.txt',
    'text/plain',
    'Agenda: launch checkpoints and owner assignments.',
  );
  const attDemoPdf = attachment(
    'att_demo_pdf',
    'invoice-2026-02.pdf',
    'application/pdf',
    'Mock PDF binary for invoice 2026-02.',
  );
  const attDemoCsv = attachment(
    'att_demo_csv',
    'report.csv',
    'text/csv',
    'name,score\nAlice,91\nBob,84\n',
  );
  const attOnboardingGuide = attachment(
    'att_onboarding_guide',
    'onboarding-guide.pdf',
    'application/pdf',
    'Onboarding checklist and system access guide.',
  );
  const attOnboardingPlan = attachment(
    'att_onboarding_plan',
    'week1-plan.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Week 1 onboarding plan (mock worksheet bytes).',
  );

  return [
    {
      messageId: 'msg_demo_001',
      threadId: 'thread_demo_001',
      subject: 'Q3 budget update',
      sender: 'Anna <anna@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(2, 11),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText:
        'Hi, here is the latest budget update for Q3. Please confirm if we should proceed with the vendor.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_002',
      threadId: 'thread_demo_002',
      subject: 'API credentials handoff',
      sender: 'Sarah <sarah@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(4, 10),
      labelIds: ['INBOX'],
      bodyText:
        'Sharing API credentials in the secure vault link. Use service account api-eval-readonly.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_002_b',
      threadId: 'thread_demo_002',
      subject: 'Re: API credentials handoff',
      sender: `${MOCK_OWNER_EMAIL}`,
      recipients: ['sarah@company.com'],
      receivedAt: daysAgo(3, 9),
      labelIds: ['SENT'],
      bodyText: 'Thanks, I can access the vault and rotate keys later today.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_010',
      threadId: 'thread_demo_010',
      subject: 'Budget approval request',
      sender: 'Anna <anna@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(1, 8),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Can you approve the budget line items? I need your sign-off today.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_011',
      threadId: 'thread_demo_011',
      subject: 'Invoice 2026-02',
      sender: 'Anna <anna@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(5, 13),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Please see attached invoice for February.',
      attachments: [attDemoPdf],
    },
    {
      messageId: 'msg_demo_100',
      threadId: 'thread_demo_100',
      subject: 'Project files',
      sender: 'Ops Bot <ops@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(6, 9),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Attached latest agenda for planning.',
      attachments: [attDemo100],
    },
    {
      messageId: 'msg_demo_101',
      threadId: 'thread_demo_101',
      subject: 'Archive/trash sample',
      sender: 'Ops Bot <ops@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(7, 9),
      labelIds: ['INBOX'],
      bodyText: 'Use this message for modify action tests.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_102',
      threadId: 'thread_demo_102',
      subject: 'Label sample thread',
      sender: 'Ops Bot <ops@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(8, 9),
      labelIds: ['INBOX'],
      bodyText: 'Use this thread for add/remove label tests.',
      attachments: [],
    },
    {
      messageId: 'msg_demo_200',
      threadId: 'thread_demo_200',
      subject: 'Attachment sample PDF',
      sender: 'Billing <billing@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(9, 9),
      labelIds: ['INBOX'],
      bodyText: 'PDF sample attached.',
      attachments: [attDemoPdf],
    },
    {
      messageId: 'msg_demo_300',
      threadId: 'thread_demo_300',
      subject: 'Attachment sample CSV',
      sender: 'Data Team <data@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(10, 9),
      labelIds: ['INBOX'],
      bodyText: 'CSV sample attached.',
      attachments: [attDemoCsv],
    },
    {
      messageId: 'msg_onboarding_001',
      threadId: 'thread_onboarding_001',
      subject: 'Onboarding package',
      sender: 'HR <hr@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(1, 12),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Welcome aboard. See attached onboarding documents.',
      attachments: [attOnboardingGuide, attOnboardingPlan],
    },
    {
      messageId: 'msg_news_001',
      threadId: 'thread_news_001',
      subject: 'Weekly newsletter: product updates',
      sender: 'Newsletters <newsletter@updates.example.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(40, 7),
      labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
      bodyText: 'Weekly highlights and release notes.',
      attachments: [],
    },
    {
      messageId: 'msg_client_sent_001',
      threadId: 'thread_client_001',
      subject: 'Proposal follow-up',
      sender: MOCK_OWNER_EMAIL,
      recipients: ['client@acme.com'],
      receivedAt: daysAgo(2, 15),
      labelIds: ['SENT'],
      bodyText: 'Following up on the proposal we sent on Monday.',
      attachments: [],
    },
    {
      messageId: 'msg_client_reply_001',
      threadId: 'thread_client_001',
      subject: 'Re: Proposal follow-up',
      sender: 'Client <client@acme.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(1, 16),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Thanks, we reviewed it. Can you share a revised timeline?',
      attachments: [],
    },
    {
      messageId: 'msg_invoice_anna_001',
      threadId: 'thread_invoice_anna_001',
      subject: 'Anna invoice confirmation',
      sender: 'Anna <anna@company.com>',
      recipients: [MOCK_OWNER_EMAIL],
      receivedAt: daysAgo(3, 14),
      labelIds: ['INBOX', 'UNREAD'],
      bodyText: 'Latest invoice attached for confirmation.',
      attachments: [attDemoPdf],
    },
  ];
};

const createState = (): MockState => {
  const messages = new Map<string, MockMessage>();
  for (const message of makeInitialMessages()) {
    messages.set(message.messageId, {
      ...message,
      recipients: [...message.recipients],
      labelIds: [...message.labelIds],
      attachments: message.attachments.map((item) => ({ ...item })),
    });
  }
  return {
    messages,
    draftCounter: 1,
    sentCounter: 1,
    threadCounter: 1,
  };
};

const state = createState();

const getMessage = (messageId: string): MockMessage => {
  const found = state.messages.get(messageId);
  if (!found) {
    throw new Error(`Message not found: ${messageId}`);
  }
  return found;
};

const getThreadMessages = (threadId: string): MockMessage[] => {
  const items = [...state.messages.values()].filter((message) => message.threadId === threadId);
  if (items.length === 0) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  return items.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
};

const attachmentSummaries = (message: MockMessage): GmailAttachmentSummary[] =>
  message.attachments.map((item) => ({
    attachmentId: item.attachmentId,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
  }));

const toReadMessage = (message: MockMessage): GmailReadMessage => ({
  messageId: message.messageId,
  sender: message.sender,
  recipients: [...message.recipients],
  receivedAt: message.receivedAt,
  isDraft: message.labelIds.includes('DRAFT'),
  isRead: !message.labelIds.includes('UNREAD'),
  labels: message.labelIds.map((label) => normalizeLabelName(label)),
  bodyText: message.bodyText,
  attachments: attachmentSummaries(message),
});

const toSearchItem = (message: MockMessage): GmailSearchItem => ({
  messageId: message.messageId,
  threadId: message.threadId,
  subject: message.subject,
  sender: message.sender,
  recipients: [...message.recipients],
  receivedAt: message.receivedAt,
  isDraft: message.labelIds.includes('DRAFT'),
  isRead: !message.labelIds.includes('UNREAD'),
  labels: message.labelIds.map((label) => normalizeLabelName(label)),
  attachments: attachmentSummaries(message),
});

const resolveFolderLabel = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'drafts' || normalized === 'draft') return 'DRAFT';
  if (normalized === 'inbox') return 'INBOX';
  if (normalized === 'sent') return 'SENT';
  if (normalized === 'trash') return 'TRASH';
  return normalized.toUpperCase();
};

const parseCursorOffset = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/i.exec(cursor.trim());
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const parseQuery = (query: string): ParsedQuery => {
  const source = query.toLowerCase().trim();
  const collect = (regex: RegExp): string[] =>
    [...source.matchAll(regex)].map((match) => (match[1] ?? '').trim()).filter(Boolean);

  const from = collect(/\bfrom:([^\s)]+)/g);
  const to = collect(/\bto:([^\s)]+)/g);
  const isFlags = collect(/\bis:([^\s)]+)/g);
  const inFolders = collect(/\bin:([^\s)]+)/g);
  const categories = collect(/\bcategory:([^\s)]+)/g);
  const hasAttachment = /\bhas:attachment\b/.test(source);

  const newerThanMatch = source.match(/\bnewer_than:(\d+)d\b/);
  const olderThanMatch = source.match(/\bolder_than:(\d+)d\b/);
  const newerThanDays = newerThanMatch ? Number(newerThanMatch[1]) : undefined;
  const olderThanDays = olderThanMatch ? Number(olderThanMatch[1]) : undefined;

  const subjectAny = [
    ...collect(/\bsubject:\(([^)]+)\)/g)
      .flatMap((value) => value.split(/\bor\b/g))
      .map((value) => value.replace(/["']/g, '').trim())
      .filter(Boolean),
    ...collect(/\bsubject:([^\s)]+)/g).map((value) => value.replace(/["']/g, '').trim()),
  ].map((value) => value.toLowerCase());

  const keywords = source
    .replace(/\bsubject:\([^)]+\)/g, ' ')
    .replace(/\bsubject:[^\s)]+/g, ' ')
    .replace(/\b(from|to|is|in|category|has|newer_than|older_than):[^\s)]+/g, ' ')
    .replace(/["'(),]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

  return {
    from,
    to,
    isFlags,
    inFolders,
    categories,
    hasAttachment,
    subjectAny,
    newerThanDays,
    olderThanDays,
    keywords,
  };
};

const matchesQuery = (message: MockMessage, parsed: ParsedQuery): boolean => {
  const sender = message.sender.toLowerCase();
  const recipients = message.recipients.map((item) => item.toLowerCase());
  const subject = message.subject.toLowerCase();
  const labels = new Set(message.labelIds.map((label) => label.toUpperCase()));

  for (const expected of parsed.from) {
    if (!sender.includes(expected)) return false;
  }
  for (const expected of parsed.to) {
    if (!recipients.some((entry) => entry.includes(expected))) return false;
  }

  for (const flag of parsed.isFlags) {
    if (flag === 'draft' && !labels.has('DRAFT')) return false;
    if (flag === 'unread' && !labels.has('UNREAD')) return false;
    if (flag === 'read' && labels.has('UNREAD')) return false;
    if (flag === 'sent' && !labels.has('SENT')) return false;
  }

  if (parsed.hasAttachment && message.attachments.length === 0) {
    return false;
  }

  for (const folder of parsed.inFolders) {
    const target = resolveFolderLabel(folder);
    if (!labels.has(target)) return false;
  }

  for (const category of parsed.categories) {
    const target = `CATEGORY_${category.trim().toUpperCase()}`;
    if (!labels.has(target)) return false;
  }

  if (parsed.subjectAny.length > 0) {
    const hasSubjectMatch = parsed.subjectAny.some((needle) => subject.includes(needle));
    if (!hasSubjectMatch) return false;
  }

  const timestamp = new Date(message.receivedAt).getTime();
  if (parsed.newerThanDays && Number.isFinite(timestamp)) {
    const cutoff = Date.now() - parsed.newerThanDays * DAY_MS;
    if (timestamp < cutoff) return false;
  }
  if (parsed.olderThanDays && Number.isFinite(timestamp)) {
    const cutoff = Date.now() - parsed.olderThanDays * DAY_MS;
    if (timestamp >= cutoff) return false;
  }

  if (parsed.keywords.length === 0) return true;
  const haystack = `${subject} ${sender} ${recipients.join(' ')} ${message.bodyText.toLowerCase()}`;
  return parsed.keywords.some((keyword) => haystack.includes(keyword));
};

const keywordScore = (message: MockMessage, keywords: string[]): number => {
  if (keywords.length === 0) return 0;
  const haystack = `${message.subject} ${message.sender} ${message.recipients.join(' ')} ${message.bodyText}`.toLowerCase();
  return keywords.reduce((score, keyword) => (haystack.includes(keyword) ? score + 1 : score), 0);
};

const applyActionToLabels = (
  currentLabelIds: string[],
  action: ModifyAction,
  labelId: string | undefined,
): string[] => {
  const labels = new Set(currentLabelIds.map((value) => value.toUpperCase()));

  switch (action) {
    case 'markRead':
      labels.delete('UNREAD');
      break;
    case 'markUnread':
      labels.add('UNREAD');
      break;
    case 'archive':
      labels.delete('INBOX');
      break;
    case 'unarchive':
      labels.add('INBOX');
      break;
    case 'trash':
      labels.add('TRASH');
      labels.delete('INBOX');
      break;
    case 'untrash':
      labels.delete('TRASH');
      labels.add('INBOX');
      break;
    case 'addLabel':
      if (!labelId) throw new Error('label is required for addLabel/removeLabel.');
      labels.add(labelId);
      break;
    case 'removeLabel':
      if (!labelId) throw new Error('label is required for addLabel/removeLabel.');
      labels.delete(labelId);
      break;
    default:
      throw new Error(`Unsupported action: ${action}`);
  }

  return [...labels];
};

const resolveLabelId = (labelName: string): string | null => {
  const target = labelName.trim();
  if (!target) return null;
  if (MOCK_LABELS.has(target)) return target;

  const upperTarget = target.toUpperCase();
  if (MOCK_LABELS.has(upperTarget)) return upperTarget;

  const normalizedTarget = normalizeLabelName(target).toLowerCase();
  for (const [id, name] of MOCK_LABELS.entries()) {
    if (name.toLowerCase() === target.toLowerCase()) return id;
    if (normalizeLabelName(name).toLowerCase() === normalizedTarget) return id;
  }
  return null;
};

const ensureReplyPrefix = (subject: string): string =>
  /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;

const ensureForwardPrefix = (subject: string): string =>
  /^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`;

const buildForwardBody = (source: MockMessage, userBodyText: string): string => {
  const forwardedBlock = [
    '---------- Forwarded message ----------',
    `From: ${source.sender}`,
    `Subject: ${source.subject}`,
    `Date: ${source.receivedAt}`,
    '',
    source.bodyText.trim(),
  ].join('\n');
  const prefix = userBodyText.trim();
  return prefix ? `${prefix}\n\n${forwardedBlock}` : forwardedBlock;
};

const nextMockId = (prefix: string, counter: number): string =>
  `${prefix}_${String(counter).padStart(4, '0')}`;

const getEffectiveSendWhitelist = (): string[] => {
  const configured = GMAIL_SEND_WHITELIST.map(normalizeRecipientEmail).filter(Boolean);
  return uniqueStrings([MOCK_OWNER_EMAIL, ...MOCK_DEFAULT_SEND_WHITELIST, ...configured]);
};

export const searchMessages = async (params: SearchParams): Promise<GmailSearchResult> => {
  const parsed = parseQuery(params.query.trim());
  const all = [...state.messages.values()];
  const matched = all
    .filter((message) => matchesQuery(message, parsed))
    .sort((a, b) => {
      const byScore = keywordScore(b, parsed.keywords) - keywordScore(a, parsed.keywords);
      if (byScore !== 0) return byScore;
      return b.receivedAt.localeCompare(a.receivedAt);
    });

  const offset = parseCursorOffset(params.cursor);
  const page = matched.slice(offset, offset + params.limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < matched.length ? `offset:${nextOffset}` : null;

  return {
    items: page.map((message) => toSearchItem(message)),
    nextCursor,
  };
};

export const readMessages = async (params: ReadParams): Promise<GmailReadResult> => {
  const message = state.messages.get(params.id);
  if (message) {
    return {
      kind: 'message',
      threadId: message.threadId,
      subject: message.subject,
      messages: [toReadMessage(message)],
    };
  }

  const threadMsgs = [...state.messages.values()].filter(
    (m) => m.threadId === params.id,
  );
  if (threadMsgs.length > 0) {
    const sorted = threadMsgs.sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    );
    return {
      kind: 'thread',
      threadId: params.id,
      subject: sorted[0]?.subject ?? '',
      messages: sorted.map((m) => toReadMessage(m)),
    };
  }

  throw new Error(
    `No message or thread found for id "${params.id}". Verify the ID from a recent gmail_search result.`,
  );
};

export const sendMessage = async (params: SendParams): Promise<GmailSendResult> => {
  let to = [...params.to];
  const cc = [...params.cc];
  const bcc = [...params.bcc];
  let subject = (params.subject ?? '').trim();
  let bodyText = params.bodyText.trim();
  let threadId: string | undefined;

  if (params.mode === 'reply') {
    if (!params.replyToMessageId) {
      throw new Error('replyToMessageId is required when mode=reply.');
    }
    const source = getMessage(params.replyToMessageId);
    if (to.length === 0) {
      to = [source.sender];
    }
    if (to.length === 0) {
      throw new Error('Could not infer recipient for reply. Pass `to` explicitly.');
    }
    subject = ensureReplyPrefix(subject || source.subject || '(no subject)');
    threadId = source.threadId;
  }

  if (params.mode === 'forward') {
    if (!params.forwardMessageId) {
      throw new Error('forwardMessageId is required when mode=forward.');
    }
    const source = getMessage(params.forwardMessageId);
    subject = ensureForwardPrefix(subject || source.subject || '(no subject)');
    bodyText = buildForwardBody(source, bodyText);
  }

  if (params.mode === 'new' && !subject) {
    throw new Error('subject is required when mode=new.');
  }
  if (to.length === 0) {
    throw new Error('At least one recipient is required.');
  }
  if (!subject) {
    throw new Error('subject is required.');
  }
  if (!bodyText) {
    throw new Error('bodyText is required.');
  }

  const whitelist = getEffectiveSendWhitelist();
  const whitelistSet = new Set(whitelist);
  const allRecipients = uniqueStrings([...to, ...cc, ...bcc]);
  const blockedRecipients = allRecipients.filter((recipient) => {
    const normalized = normalizeRecipientEmail(recipient);
    return !normalized || !whitelistSet.has(normalized);
  });
  const enforcedDraft = blockedRecipients.length > 0;
  const shouldDraft = params.saveAsDraft || enforcedDraft;

  if (!threadId) {
    threadId = nextMockId('thread_mock', state.threadCounter);
    state.threadCounter += 1;
  }

  const messageId = shouldDraft
    ? nextMockId('msg_mock_draft', state.draftCounter)
    : nextMockId('msg_mock_sent', state.sentCounter);
  if (shouldDraft) {
    state.draftCounter += 1;
  } else {
    state.sentCounter += 1;
  }

  const createdMessage: MockMessage = {
    messageId,
    threadId,
    subject,
    sender: MOCK_OWNER_EMAIL,
    recipients: uniqueStrings([...to, ...cc, ...bcc]),
    receivedAt: new Date().toISOString(),
    labelIds: shouldDraft ? ['DRAFT'] : ['SENT'],
    bodyText,
    attachments: [],
  };
  state.messages.set(createdMessage.messageId, createdMessage);

  return {
    status: shouldDraft ? 'drafted' : 'sent',
    mode: params.mode,
    messageId: createdMessage.messageId,
    threadId: createdMessage.threadId,
    draftId: shouldDraft ? nextMockId('draft_mock', state.draftCounter - 1) : null,
    policy: {
      enforcedDraft,
      blockedRecipients,
      whitelist,
    },
  };
};

export const modifyMailboxItem = async (params: ModifyParams): Promise<GmailModifyResult> => {
  const resolvedLabelId = params.label ? resolveLabelId(params.label) : null;
  if ((params.action === 'addLabel' || params.action === 'removeLabel') && !resolvedLabelId) {
    throw new Error(`Unknown label: ${params.label}`);
  }

  if (params.kind === 'message') {
    const message = getMessage(params.id);
    message.labelIds = applyActionToLabels(message.labelIds, params.action, resolvedLabelId ?? undefined);
    return {
      kind: 'message',
      id: params.id,
      appliedAction: params.action,
      labels: message.labelIds.map((label) => normalizeLabelName(label)),
    };
  }

  const threadMessages = getThreadMessages(params.id);
  for (const message of threadMessages) {
    message.labelIds = applyActionToLabels(message.labelIds, params.action, resolvedLabelId ?? undefined);
  }

  const threadLabels = uniqueStrings(
    threadMessages.flatMap((message) => message.labelIds.map((label) => normalizeLabelName(label))),
  );

  return {
    kind: 'thread',
    id: params.id,
    appliedAction: params.action,
    labels: threadLabels,
  };
};

export const downloadAttachment = async (
  params: AttachmentParams,
): Promise<GmailAttachmentResult> => {
  const message = getMessage(params.messageId);
  const found = message.attachments.find((item) => item.attachmentId === params.attachmentId);
  if (!found) {
    throw new Error(
      `Attachment not found: messageId=${params.messageId} attachmentId=${params.attachmentId}`,
    );
  }

  return {
    messageId: params.messageId,
    attachmentId: params.attachmentId,
    filename: found.filename,
    mimeType: found.mimeType,
    size: found.size,
    contentBase64: found.contentBase64,
  };
};
