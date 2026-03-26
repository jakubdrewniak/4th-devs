import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import { google, type gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { ROOT_DIR } from '../config.js';
import { getGmailAuthClient } from '../gmail/auth.js';

interface CliOptions {
  queries: string[];
  limit: number;
  sampleMessages: number;
  outDir: string;
}

interface ProbeValueSummary {
  shape: unknown;
  sample: unknown;
}

interface AttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

const DEFAULT_QUERIES = [
  'overment',
  'is:draft',
  'has:attachment',
  'in:inbox is:unread',
  'in:sent newer_than:30d',
  'subject:(invoice OR faktura)',
];

const DEFAULT_METADATA_HEADERS = [
  'From',
  'To',
  'Cc',
  'Bcc',
  'Subject',
  'Date',
  'Message-ID',
  'References',
  'In-Reply-To',
];

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;
const DEFAULT_SAMPLE_MESSAGES = 2;
const MIN_SAMPLE_MESSAGES = 1;
const MAX_SAMPLE_MESSAGES = 10;

const DEFAULT_OUT_DIR = resolve(ROOT_DIR, 'workspace', 'probes');

const CLI_OPTIONS = {
  query: { type: 'string', multiple: true },
  queries: { type: 'string', multiple: true },
  limit: { type: 'string' },
  'sample-messages': { type: 'string' },
  'out-dir': { type: 'string' },
} as const;

const CliOptionsSchema = z.object({
  queries: z.array(z.string().trim().min(1)).min(1),
  limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT),
  sampleMessages: z.number().int().min(MIN_SAMPLE_MESSAGES).max(MAX_SAMPLE_MESSAGES),
  outDir: z.string().trim().min(1),
});

const normalizeBoundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const parseCsvQueries = (items: string[]): string[] =>
  items
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const parseCliOptions = (argv: string[]): CliOptions => {
  const { values } = parseNodeArgs({
    args: argv,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
  });

  const directQueries = (values.query ?? [])
    .map((query) => query.trim())
    .filter((query) => query.length > 0);

  const csvQueries = parseCsvQueries(values.queries ?? []);
  const selectedQueries = [...new Set([...directQueries, ...csvQueries])];
  const queries = selectedQueries.length > 0 ? selectedQueries : DEFAULT_QUERIES;

  const parsed = CliOptionsSchema.safeParse({
    queries,
    limit: normalizeBoundedInt(values.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT),
    sampleMessages: normalizeBoundedInt(
      values['sample-messages'],
      DEFAULT_SAMPLE_MESSAGES,
      MIN_SAMPLE_MESSAGES,
      MAX_SAMPLE_MESSAGES,
    ),
    outDir: values['out-dir'] ? resolve(ROOT_DIR, values['out-dir']) : DEFAULT_OUT_DIR,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid CLI arguments.');
  }

  return parsed.data;
};

const safeString = (value: string, max = 240): string =>
  value.length <= max ? value : `${value.slice(0, max)} ... (len=${value.length})`;

const sanitizeForOutput = (value: unknown, depth = 0): unknown => {
  if (value == null) return value;
  if (depth > 6) return '[max-depth]';

  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const sample = value.slice(0, 8).map((item) => sanitizeForOutput(item, depth + 1));
    if (value.length > 8) {
      sample.push(`... (${value.length - 8} more items)`);
    }
    return sample;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [index, [key, entryValue]] of entries.entries()) {
      if (index >= 40) {
        sanitized.__truncatedKeys = `... (${entries.length - 40} more keys)`;
        break;
      }
      sanitized[key] = sanitizeForOutput(entryValue, depth + 1);
    }
    return sanitized;
  }

  return String(value);
};

const primitiveType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const describeShape = (value: unknown, depth = 0): unknown => {
  const type = primitiveType(value);
  if (depth > 6) return type;

  if (type === 'array') {
    const arrayValue = value as unknown[];
    const itemTypes = [...new Set(arrayValue.map((item) => primitiveType(item)))];
    return {
      type: 'array',
      length: arrayValue.length,
      itemTypes,
      itemShape: arrayValue.length > 0 ? describeShape(arrayValue[0], depth + 1) : 'unknown',
    };
  }

  if (type === 'object') {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue);
    const shape: Record<string, unknown> = {};
    for (const [index, key] of keys.entries()) {
      if (index >= 40) {
        shape.__truncatedKeys = `... (${keys.length - 40} more keys)`;
        break;
      }
      shape[key] = describeShape(objectValue[key], depth + 1);
    }
    return {
      type: 'object',
      keys: shape,
    };
  }

  return type;
};

const summarize = (value: unknown): ProbeValueSummary => ({
  shape: describeShape(value),
  sample: sanitizeForOutput(value),
});

const collectAttachmentRefs = (
  part: gmail_v1.Schema$MessagePart | null | undefined,
): AttachmentRef[] => {
  if (!part) return [];
  const refs: AttachmentRef[] = [];

  const walk = (current: gmail_v1.Schema$MessagePart): void => {
    const attachmentId = current.body?.attachmentId ?? '';
    if (attachmentId) {
      refs.push({
        attachmentId,
        filename: current.filename?.trim() || '(unnamed)',
        mimeType: current.mimeType ?? 'application/octet-stream',
        size: current.body?.size ?? 0,
      });
    }
    for (const child of current.parts ?? []) {
      walk(child);
    }
  };

  walk(part);
  return refs;
};

const probeMessage = async (
  gmail: gmail_v1.Gmail,
  messageId: string,
  threadId: string | null | undefined,
): Promise<unknown> => {
  const [minimal, metadata, full] = await Promise.all([
    gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'minimal',
    }),
    gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: DEFAULT_METADATA_HEADERS,
    }),
    gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    }),
  ]);

  const thread =
    typeof threadId === 'string' && threadId.length > 0
      ? await gmail.users.threads
          .get({
            userId: 'me',
            id: threadId,
            format: 'full',
          })
          .then((result) => summarize(result.data))
          .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      : { skipped: 'threadId missing' };

  const attachments = collectAttachmentRefs(full.data.payload).slice(0, 2);
  const attachmentBodies = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const result = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachment.attachmentId,
        });

        return {
          ref: attachment,
          body: summarize({
            ...result.data,
            dataLength: result.data.data?.length ?? 0,
            dataPreview: result.data.data ? safeString(result.data.data, 80) : '',
          }),
        };
      } catch (error) {
        return {
          ref: attachment,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    messageId,
    threadId: threadId ?? null,
    variants: {
      minimal: summarize(minimal.data),
      metadata: summarize(metadata.data),
      full: summarize(full.data),
    },
    thread,
    attachmentBodies,
  };
};

const probeQuery = async (
  gmail: gmail_v1.Gmail,
  query: string,
  limit: number,
  sampleMessages: number,
): Promise<unknown> => {
  const [messagesList, threadsList] = await Promise.all([
    gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: limit,
    }),
    gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: limit,
    }),
  ]);

  const messageItems = messagesList.data.messages ?? [];
  const samples = await Promise.all(
    messageItems.slice(0, sampleMessages).map((item) =>
      probeMessage(gmail, item.id ?? '', item.threadId).catch((error) => ({
        messageId: item.id ?? '',
        error: error instanceof Error ? error.message : String(error),
      })),
    ),
  );

  return {
    query,
    messagesList: {
      count: messageItems.length,
      nextPageToken: messagesList.data.nextPageToken ?? null,
      summary: summarize(messagesList.data),
    },
    threadsList: {
      count: (threadsList.data.threads ?? []).length,
      nextPageToken: threadsList.data.nextPageToken ?? null,
      summary: summarize(threadsList.data),
    },
    messageSamples: samples,
  };
};

const nowStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const main = async (): Promise<void> => {
  const options = parseCliOptions(process.argv.slice(2));
  const auth = await getGmailAuthClient();
  await auth.getAccessToken();
  const gmail = google.gmail({ version: 'v1', auth });

  const [profile, labels, drafts] = await Promise.all([
    gmail.users.getProfile({ userId: 'me' }),
    gmail.users.labels.list({ userId: 'me' }),
    gmail.users.drafts.list({ userId: 'me', maxResults: options.limit }),
  ]);

  const draftItems = drafts.data.drafts ?? [];
  const draftSample =
    draftItems.length > 0 && draftItems[0].id
      ? await gmail.users.drafts
          .get({
            userId: 'me',
            id: draftItems[0].id,
            format: 'full',
          })
          .then((result) => summarize(result.data))
          .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      : { skipped: 'No drafts available' };

  const queryReports = [];
  for (const query of options.queries) {
    // Keep live probing sequential to reduce Gmail quota bursts.
    const report = await probeQuery(gmail, query, options.limit, options.sampleMessages);
    queryReports.push(report);
    console.log(`Probed query "${query}"`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    accountEmail: profile.data.emailAddress ?? null,
    options,
    probes: {
      profile: summarize(profile.data),
      labelsList: summarize(labels.data),
      draftsList: summarize(drafts.data),
      draftSample,
      queries: queryReports,
    },
  };

  await mkdir(options.outDir, { recursive: true });
  const outputPath = resolve(options.outDir, `gmail-api-shapes-${nowStamp()}.json`);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  console.log('\nDone.');
  console.log(`Account: ${profile.data.emailAddress ?? 'unknown'}`);
  console.log(`Queries: ${options.queries.length}`);
  console.log(`Output: ${outputPath}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Probe failed: ${message}`);
  process.exit(1);
});
