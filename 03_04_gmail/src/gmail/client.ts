import { google, type gmail_v1 } from 'googleapis';
import { getGmailAuthClient } from './auth.js';
import { EVAL_MOCK_GMAIL, GMAIL_SEND_WHITELIST } from '../config.js';
import {
  downloadAttachment as downloadAttachmentMock,
  modifyMailboxItem as modifyMailboxItemMock,
  readMessages as readMessagesMock,
  searchMessages as searchMessagesMock,
  sendMessage as sendMessageMock,
} from './mock-client.js';
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

export type ModifyAction =
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

interface AttachmentPartMeta {
  filename: string;
  mimeType: string;
  size: number;
}

const LABEL_CACHE_TTL_MS = 5 * 60 * 1000;
let labelCache:
  | {
      expiresAt: number;
      map: Map<string, string>;
    }
  | undefined;

const createGmailClient = async (): Promise<gmail_v1.Gmail> => {
  const auth = await getGmailAuthClient();
  await auth.getAccessToken();
  return google.gmail({ version: 'v1' as const, auth });
};

const getHeaderValue = (
  headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined,
  name: string,
): string => {
  if (!headers) return '';
  const found = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
};

const splitRecipients = (value: string): string[] =>
  value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const uniqueStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const collectRecipients = (
  headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined,
): string[] =>
  uniqueStrings([
    ...splitRecipients(getHeaderValue(headers, 'To')),
    ...splitRecipients(getHeaderValue(headers, 'Cc')),
    ...splitRecipients(getHeaderValue(headers, 'Bcc')),
  ]);

const toIso = (internalDate: string | null | undefined, headerDate: string): string => {
  const fromInternal = Number(internalDate);
  if (Number.isFinite(fromInternal) && fromInternal > 0) {
    return new Date(fromInternal).toISOString();
  }

  const fromHeader = new Date(headerDate);
  if (!Number.isNaN(fromHeader.getTime())) {
    return fromHeader.toISOString();
  }

  return '';
};

const toTimestamp = (message: gmail_v1.Schema$Message): number => {
  const fromInternal = Number(message.internalDate);
  if (Number.isFinite(fromInternal) && fromInternal > 0) return fromInternal;

  const fromHeader = new Date(getHeaderValue(message.payload?.headers, 'Date')).getTime();
  if (!Number.isNaN(fromHeader) && fromHeader > 0) return fromHeader;

  return 0;
};

const normalizeLabelName = (label: string): string => {
  if (label.startsWith('CATEGORY_')) return label.slice('CATEGORY_'.length).toLowerCase();
  if (/^[A-Z_]+$/.test(label)) return label.toLowerCase();
  return label;
};

const toBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(paddingLength);
};

const decodeBase64UrlUtf8 = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    return Buffer.from(toBase64(value), 'base64').toString('utf-8');
  } catch {
    return '';
  }
};

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const findPartBodyData = (
  part: gmail_v1.Schema$MessagePart | null | undefined,
  mimeType: string,
): string => {
  if (!part) return '';

  const partMimeType = (part.mimeType ?? '').toLowerCase();
  if (partMimeType === mimeType && part.body?.data) {
    return decodeBase64UrlUtf8(part.body.data);
  }

  for (const nested of part.parts ?? []) {
    const candidate = findPartBodyData(nested, mimeType);
    if (candidate) return candidate;
  }

  return '';
};

const extractBodyText = (payload: gmail_v1.Schema$MessagePart | null | undefined): string => {
  if (!payload) return '';

  const plain = findPartBodyData(payload, 'text/plain');
  if (plain) return plain.trim();

  const html = findPartBodyData(payload, 'text/html');
  if (html) return stripHtml(html);

  const fallback = decodeBase64UrlUtf8(payload.body?.data);
  return fallback.trim();
};

const collectAttachments = (
  part: gmail_v1.Schema$MessagePart | null | undefined,
): GmailAttachmentSummary[] => {
  if (!part) return [];

  const attachments = new Map<string, GmailAttachmentSummary>();

  const walk = (current: gmail_v1.Schema$MessagePart): void => {
    const attachmentId = current.body?.attachmentId ?? '';
    if (attachmentId) {
      attachments.set(attachmentId, {
        attachmentId,
        filename: current.filename?.trim() || '(unnamed)',
        mimeType: current.mimeType ?? 'application/octet-stream',
        size: current.body?.size ?? 0,
      });
    }

    for (const nested of current.parts ?? []) {
      walk(nested);
    }
  };

  walk(part);
  return [...attachments.values()];
};

const findAttachmentPart = (
  part: gmail_v1.Schema$MessagePart | null | undefined,
  attachmentId: string,
): AttachmentPartMeta | null => {
  if (!part) return null;

  if (part.body?.attachmentId === attachmentId) {
    return {
      filename: part.filename?.trim() || '(unnamed)',
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body?.size ?? 0,
    };
  }

  for (const nested of part.parts ?? []) {
    const found = findAttachmentPart(nested, attachmentId);
    if (found) return found;
  }

  return null;
};

const fetchLabelMap = async (gmail: gmail_v1.Gmail): Promise<Map<string, string>> => {
  const response = await gmail.users.labels.list({ userId: 'me' });
  const map = new Map<string, string>();
  for (const label of response.data.labels ?? []) {
    if (label.id && label.name) {
      map.set(label.id, label.name);
    }
  }
  return map;
};

const getLabelMap = async (gmail: gmail_v1.Gmail): Promise<Map<string, string>> => {
  const now = Date.now();
  if (labelCache && labelCache.expiresAt > now) {
    return labelCache.map;
  }

  const map = await fetchLabelMap(gmail);
  labelCache = {
    expiresAt: now + LABEL_CACHE_TTL_MS,
    map,
  };
  return map;
};

const resolveLabels = (labelIds: string[] | null | undefined, labelMap: Map<string, string>): string[] =>
  (labelIds ?? []).map((id) => normalizeLabelName(labelMap.get(id) ?? id));

const resolveThreadLabels = (
  thread: gmail_v1.Schema$Thread,
  labelMap: Map<string, string>,
): string[] => {
  const ids = new Set<string>();
  for (const message of thread.messages ?? []) {
    for (const labelId of message.labelIds ?? []) {
      ids.add(labelId);
    }
  }
  return resolveLabels([...ids], labelMap);
};

const resolveLabelId = (labelMap: Map<string, string>, labelName: string): string | null => {
  const target = labelName.trim();
  if (!target) return null;

  if (labelMap.has(target)) return target;

  const upperTarget = target.toUpperCase();
  if (labelMap.has(upperTarget)) return upperTarget;

  const normalizedTarget = normalizeLabelName(target).toLowerCase();
  for (const [id, name] of labelMap.entries()) {
    if (name.toLowerCase() === target.toLowerCase()) return id;
    if (normalizeLabelName(name).toLowerCase() === normalizedTarget) return id;
  }

  return null;
};

const toSearchItem = (message: gmail_v1.Schema$Message, labelMap: Map<string, string>): GmailSearchItem => {
  const headers = message.payload?.headers;
  const labelIds = message.labelIds ?? [];
  return {
    messageId: message.id ?? '',
    threadId: message.threadId ?? '',
    subject: getHeaderValue(headers, 'Subject'),
    sender: getHeaderValue(headers, 'From'),
    recipients: collectRecipients(headers),
    receivedAt: toIso(message.internalDate, getHeaderValue(headers, 'Date')),
    isDraft: labelIds.includes('DRAFT'),
    isRead: !labelIds.includes('UNREAD'),
    labels: resolveLabels(labelIds, labelMap),
    attachments: collectAttachments(message.payload),
  };
};

const toReadMessage = (message: gmail_v1.Schema$Message, labelMap: Map<string, string>): GmailReadMessage => {
  const headers = message.payload?.headers;
  const labelIds = message.labelIds ?? [];
  return {
    messageId: message.id ?? '',
    sender: getHeaderValue(headers, 'From'),
    recipients: collectRecipients(headers),
    receivedAt: toIso(message.internalDate, getHeaderValue(headers, 'Date')),
    isDraft: labelIds.includes('DRAFT'),
    isRead: !labelIds.includes('UNREAD'),
    labels: resolveLabels(labelIds, labelMap),
    bodyText: extractBodyText(message.payload),
    attachments: collectAttachments(message.payload),
  };
};

const ensureReplyPrefix = (subject: string): string =>
  /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;

const ensureForwardPrefix = (subject: string): string =>
  /^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`;

const encodeMimeHeader = (value: string): string => {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
};

const encodeBodyBase64 = (bodyText: string): string =>
  Buffer.from(bodyText, 'utf-8').toString('base64').replace(/(.{76})/g, '$1\r\n').trimEnd();

const toRawMessage = (params: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string;
}): string => {
  const lines = [
    `To: ${params.to.join(', ')}`,
    ...(params.cc.length > 0 ? [`Cc: ${params.cc.join(', ')}`] : []),
    ...(params.bcc.length > 0 ? [`Bcc: ${params.bcc.join(', ')}`] : []),
    `Subject: ${encodeMimeHeader(params.subject)}`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBodyBase64(params.bodyText),
  ];

  return Buffer.from(lines.join('\r\n'), 'utf-8').toString('base64url');
};

const buildForwardBody = (
  headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined,
  originalBodyText: string,
  userBodyText: string,
): string => {
  const contextLines = [
    '---------- Forwarded message ----------',
    ...(getHeaderValue(headers, 'From') ? [`From: ${getHeaderValue(headers, 'From')}`] : []),
    ...(getHeaderValue(headers, 'Date') ? [`Date: ${getHeaderValue(headers, 'Date')}`] : []),
    ...(getHeaderValue(headers, 'Subject') ? [`Subject: ${getHeaderValue(headers, 'Subject')}`] : []),
    ...(getHeaderValue(headers, 'To') ? [`To: ${getHeaderValue(headers, 'To')}`] : []),
    '',
    originalBodyText.trim(),
  ];

  const prefix = userBodyText.trim();
  if (!prefix) return contextLines.join('\n');
  return `${prefix}\n\n${contextLines.join('\n')}`;
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

const getAuthorizedUserEmail = async (gmail: gmail_v1.Gmail): Promise<string> => {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = (profile.data.emailAddress ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('Could not resolve authorized Gmail user email for send policy.');
  }
  return email;
};

const getEffectiveSendWhitelist = async (gmail: gmail_v1.Gmail): Promise<string[]> => {
  const ownerEmail = await getAuthorizedUserEmail(gmail);
  const configured = GMAIL_SEND_WHITELIST.map(normalizeRecipientEmail).filter(Boolean);
  return uniqueStrings([ownerEmail, ...configured]);
};

export const searchMessages = async (params: SearchParams): Promise<GmailSearchResult> => {
  if (EVAL_MOCK_GMAIL) {
    return searchMessagesMock(params);
  }

  const gmail = await createGmailClient();

  const [listed, labelMap] = await Promise.all([
    gmail.users.messages.list({
      userId: 'me',
      q: params.query.trim() || undefined,
      maxResults: params.limit,
      pageToken: params.cursor,
    }),
    getLabelMap(gmail).catch(() => new Map<string, string>()),
  ]);

  const listedMessages = listed.data.messages ?? [];
  if (listedMessages.length === 0) {
    return {
      items: [],
      nextCursor: listed.data.nextPageToken ?? null,
    };
  }

  const detailed = await Promise.all(
    listedMessages.map(async (item) => {
      if (!item.id) return null;
      try {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: item.id,
          format: 'full',
        });
        return response.data;
      } catch {
        return null;
      }
    }),
  );

  const items = detailed
    .filter((message): message is gmail_v1.Schema$Message => Boolean(message?.id))
    .map((message) => toSearchItem(message, labelMap));

  return {
    items,
    nextCursor: listed.data.nextPageToken ?? null,
  };
};

const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && (error as { code: number }).code === 404) return true;
  if ('status' in error && (error as { status: number }).status === 404) return true;
  return false;
};

export const readMessages = async (params: ReadParams): Promise<GmailReadResult> => {
  if (EVAL_MOCK_GMAIL) {
    return readMessagesMock(params);
  }

  const gmail = await createGmailClient();
  const labelMap = await getLabelMap(gmail).catch(() => new Map<string, string>());

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: params.id,
      format: 'full',
    });

    const message = response.data;
    return {
      kind: 'message',
      threadId: message.threadId ?? '',
      subject: getHeaderValue(message.payload?.headers, 'Subject'),
      messages: [toReadMessage(message, labelMap)],
    };
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  try {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: params.id,
      format: 'full',
    });

    const sorted = [...(response.data.messages ?? [])].sort(
      (a, b) => toTimestamp(a) - toTimestamp(b),
    );
    return {
      kind: 'thread',
      threadId: response.data.id ?? params.id,
      subject: sorted.length > 0 ? getHeaderValue(sorted[0].payload?.headers, 'Subject') : '',
      messages: sorted.map((message) => toReadMessage(message, labelMap)),
    };
  } catch {
    throw new Error(
      `No message or thread found for id "${params.id}". Verify the ID from a recent gmail_search result.`,
    );
  }
};

export const sendMessage = async (params: SendParams): Promise<GmailSendResult> => {
  if (EVAL_MOCK_GMAIL) {
    return sendMessageMock(params);
  }

  const gmail = await createGmailClient();

  let to = [...params.to];
  const cc = [...params.cc];
  const bcc = [...params.bcc];
  let subject = (params.subject ?? '').trim();
  let bodyText = params.bodyText.trim();
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (params.mode === 'reply') {
    if (!params.replyToMessageId) {
      throw new Error('replyToMessageId is required when mode=reply.');
    }

    const source = await gmail.users.messages.get({
      userId: 'me',
      id: params.replyToMessageId,
      format: 'full',
    });

    const headers = source.data.payload?.headers;
    const sourceSubject = getHeaderValue(headers, 'Subject') || '(no subject)';
    const sourceSender = getHeaderValue(headers, 'From');
    const sourceMessageId = getHeaderValue(headers, 'Message-ID');
    const sourceReferences = getHeaderValue(headers, 'References');

    if (to.length === 0 && sourceSender) {
      to = [sourceSender];
    }
    if (to.length === 0) {
      throw new Error('Could not infer recipient for reply. Pass `to` explicitly.');
    }

    if (!subject) {
      subject = sourceSubject;
    }
    subject = ensureReplyPrefix(subject || '(no subject)');
    threadId = source.data.threadId ?? undefined;
    inReplyTo = sourceMessageId || undefined;
    references = [sourceReferences, sourceMessageId]
      .filter((entry) => Boolean(entry && entry.trim().length > 0))
      .join(' ')
      .trim();
    if (references.length === 0) {
      references = undefined;
    }
  }

  if (params.mode === 'forward') {
    if (!params.forwardMessageId) {
      throw new Error('forwardMessageId is required when mode=forward.');
    }

    const source = await gmail.users.messages.get({
      userId: 'me',
      id: params.forwardMessageId,
      format: 'full',
    });

    const sourceHeaders = source.data.payload?.headers;
    const sourceSubject = getHeaderValue(sourceHeaders, 'Subject') || '(no subject)';
    const sourceBodyText = extractBodyText(source.data.payload);
    if (!subject) {
      subject = ensureForwardPrefix(sourceSubject);
    } else {
      subject = ensureForwardPrefix(subject);
    }

    bodyText = buildForwardBody(sourceHeaders, sourceBodyText, bodyText);
  }

  if (params.mode === 'new') {
    if (!subject) {
      throw new Error('subject is required when mode=new.');
    }
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

  const effectiveWhitelist = await getEffectiveSendWhitelist(gmail);
  const whitelistSet = new Set(effectiveWhitelist);
  const allRecipients = uniqueStrings([...to, ...cc, ...bcc]);
  const blockedRecipients = allRecipients.filter((recipient) => {
    const normalized = normalizeRecipientEmail(recipient);
    return !normalized || !whitelistSet.has(normalized);
  });
  const enforcedDraft = blockedRecipients.length > 0;
  const shouldDraft = params.saveAsDraft || enforcedDraft;

  const raw = toRawMessage({
    to,
    cc,
    bcc,
    subject,
    bodyText,
    inReplyTo,
    references,
  });

  if (shouldDraft) {
    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          ...(threadId ? { threadId } : {}),
        },
      },
    });

    return {
      status: 'drafted',
      mode: params.mode,
      messageId: draft.data.message?.id ?? null,
      threadId: draft.data.message?.threadId ?? threadId ?? null,
      draftId: draft.data.id ?? null,
      policy: {
        enforcedDraft,
        blockedRecipients,
        whitelist: effectiveWhitelist,
      },
    };
  }

  const sent = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {}),
    },
  });

  return {
    status: 'sent',
    mode: params.mode,
    messageId: sent.data.id ?? null,
    threadId: sent.data.threadId ?? threadId ?? null,
    draftId: null,
    policy: {
      enforcedDraft: false,
      blockedRecipients: [],
      whitelist: effectiveWhitelist,
    },
  };
};

export const modifyMailboxItem = async (params: ModifyParams): Promise<GmailModifyResult> => {
  if (EVAL_MOCK_GMAIL) {
    return modifyMailboxItemMock(params);
  }

  const gmail = await createGmailClient();
  const labelMap = await getLabelMap(gmail).catch(() => new Map<string, string>());

  if (params.kind === 'message') {
    const applyMessageModify = async (
      addLabelIds: string[] = [],
      removeLabelIds: string[] = [],
    ): Promise<GmailModifyResult> => {
      const updated = await gmail.users.messages.modify({
        userId: 'me',
        id: params.id,
        requestBody: { addLabelIds, removeLabelIds },
      });
      return {
        kind: 'message',
        id: params.id,
        appliedAction: params.action,
        labels: resolveLabels(updated.data.labelIds, labelMap),
      };
    };

    switch (params.action) {
      case 'markRead':
        return applyMessageModify([], ['UNREAD']);
      case 'markUnread':
        return applyMessageModify(['UNREAD'], []);
      case 'archive':
        return applyMessageModify([], ['INBOX']);
      case 'unarchive':
        return applyMessageModify(['INBOX'], []);
      case 'trash': {
        const updated = await gmail.users.messages.trash({ userId: 'me', id: params.id });
        return {
          kind: 'message',
          id: params.id,
          appliedAction: params.action,
          labels: resolveLabels(updated.data.labelIds, labelMap),
        };
      }
      case 'untrash': {
        const updated = await gmail.users.messages.untrash({ userId: 'me', id: params.id });
        return {
          kind: 'message',
          id: params.id,
          appliedAction: params.action,
          labels: resolveLabels(updated.data.labelIds, labelMap),
        };
      }
      case 'addLabel':
      case 'removeLabel': {
        if (!params.label) {
          throw new Error('label is required for addLabel/removeLabel.');
        }
        const labelId = resolveLabelId(labelMap, params.label);
        if (!labelId) {
          throw new Error(`Unknown label: ${params.label}`);
        }
        return applyMessageModify(
          params.action === 'addLabel' ? [labelId] : [],
          params.action === 'removeLabel' ? [labelId] : [],
        );
      }
      default:
        throw new Error(`Unsupported action: ${params.action}`);
    }
  }

  const applyThreadModify = async (
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ): Promise<GmailModifyResult> => {
    const updated = await gmail.users.threads.modify({
      userId: 'me',
      id: params.id,
      requestBody: { addLabelIds, removeLabelIds },
    });
    return {
      kind: 'thread',
      id: params.id,
      appliedAction: params.action,
      labels: resolveThreadLabels(updated.data, labelMap),
    };
  };

  switch (params.action) {
    case 'markRead':
      return applyThreadModify([], ['UNREAD']);
    case 'markUnread':
      return applyThreadModify(['UNREAD'], []);
    case 'archive':
      return applyThreadModify([], ['INBOX']);
    case 'unarchive':
      return applyThreadModify(['INBOX'], []);
    case 'trash': {
      const updated = await gmail.users.threads.trash({ userId: 'me', id: params.id });
      return {
        kind: 'thread',
        id: params.id,
        appliedAction: params.action,
        labels: resolveThreadLabels(updated.data, labelMap),
      };
    }
    case 'untrash': {
      const updated = await gmail.users.threads.untrash({ userId: 'me', id: params.id });
      return {
        kind: 'thread',
        id: params.id,
        appliedAction: params.action,
        labels: resolveThreadLabels(updated.data, labelMap),
      };
    }
    case 'addLabel':
    case 'removeLabel': {
      if (!params.label) {
        throw new Error('label is required for addLabel/removeLabel.');
      }
      const labelId = resolveLabelId(labelMap, params.label);
      if (!labelId) {
        throw new Error(`Unknown label: ${params.label}`);
      }
      return applyThreadModify(
        params.action === 'addLabel' ? [labelId] : [],
        params.action === 'removeLabel' ? [labelId] : [],
      );
    }
    default:
      throw new Error(`Unsupported action: ${params.action}`);
  }
};

export const downloadAttachment = async (
  params: AttachmentParams,
): Promise<GmailAttachmentResult> => {
  if (EVAL_MOCK_GMAIL) {
    return downloadAttachmentMock(params);
  }

  const gmail = await createGmailClient();

  const [messageResponse, attachmentResponse] = await Promise.all([
    gmail.users.messages.get({
      userId: 'me',
      id: params.messageId,
      format: 'full',
    }),
    gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: params.messageId,
      id: params.attachmentId,
    }),
  ]);

  const attachmentMeta = findAttachmentPart(messageResponse.data.payload, params.attachmentId);
  const data = attachmentResponse.data.data ?? '';

  return {
    messageId: params.messageId,
    attachmentId: params.attachmentId,
    filename: attachmentMeta?.filename ?? '(unnamed)',
    mimeType: attachmentMeta?.mimeType ?? 'application/octet-stream',
    size: attachmentMeta?.size ?? attachmentResponse.data.size ?? 0,
    contentBase64: toBase64(data),
  };
};
