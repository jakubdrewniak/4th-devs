import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { text as readStreamText } from 'node:stream/consumers';
import { parseArgs as parseNodeArgs } from 'node:util';
import { z } from 'zod';
import { createSession, runAgentEval } from '../agent/index.js';
import { MODEL, ROOT_DIR } from '../config.js';
import { buildSystemPrompt } from '../prompt.js';

const DEFAULT_MAX_TURNS = 8;
const MIN_MAX_TURNS = 1;
const MAX_MAX_TURNS = 24;
const DEFAULT_SESSION_DIR = resolve(ROOT_DIR, 'evals', 'promptfoo', '.sessions');

const DEFAULT_INSTRUCTIONS = buildSystemPrompt();

const CliOptionsSchema = z.object({
  model: z.string().trim().min(1),
  message: z.string().trim().min(1, 'message is required (pass --message or stdin).'),
  maxTurns: z.number().int().min(MIN_MAX_TURNS).max(MAX_MAX_TURNS),
  instructions: z.string().trim().min(1),
  sessionKey: z.string().trim().min(1).optional(),
  sessionDir: z.string().trim().min(1),
});

type CliOptions = z.infer<typeof CliOptionsSchema>;

const CLI_OPTIONS = {
  model: { type: 'string' },
  message: { type: 'string' },
  'max-turns': { type: 'string' },
  instructions: { type: 'string' },
  'session-key': { type: 'string' },
  'session-dir': { type: 'string' },
} as const;

const StoredSessionSchema = z.object({
  history: z.array(z.any()),
});

const normalizeMaxTurns = (value: string | undefined): number => {
  if (!value) return DEFAULT_MAX_TURNS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_TURNS;
  const floored = Math.floor(parsed);
  return Math.max(MIN_MAX_TURNS, Math.min(MAX_MAX_TURNS, floored));
};

const readStdinText = async (): Promise<string> =>
  process.stdin.isTTY
    ? ''
    : readStreamText(process.stdin).then((value) => value.trim()).catch(() => '');

const resolveSessionDir = (value: string | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_SESSION_DIR;
  return isAbsolute(normalized) ? normalized : resolve(ROOT_DIR, normalized);
};

const getSessionPath = (sessionDir: string, sessionKey: string): string => {
  const filename = `${createHash('sha256').update(sessionKey).digest('hex')}.json`;
  return resolve(sessionDir, filename);
};

const loadSessionHistory = async (
  sessionDir: string,
  sessionKey: string | undefined,
): Promise<unknown[]> => {
  if (!sessionKey) return [];

  try {
    const raw = await readFile(getSessionPath(sessionDir, sessionKey), 'utf-8');
    const parsed = StoredSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.history : [];
  } catch {
    return [];
  }
};

const saveSessionHistory = async (
  sessionDir: string,
  sessionKey: string | undefined,
  history: unknown[],
): Promise<void> => {
  if (!sessionKey) return;

  await mkdir(sessionDir, { recursive: true });
  const payload = StoredSessionSchema.parse({ history });
  await writeFile(
    getSessionPath(sessionDir, sessionKey),
    `${JSON.stringify(payload)}\n`,
    'utf-8',
  );
};

const parseCliOptions = async (argv: string[]): Promise<CliOptions> => {
  const { values } = parseNodeArgs({
    args: argv,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
  });

  const messageFromArg = values.message?.trim() ?? '';
  const message = messageFromArg || (await readStdinText());

  const parsed = CliOptionsSchema.safeParse({
    model: values.model?.trim() || process.env.EVAL_MODEL?.trim() || MODEL,
    message,
    maxTurns: normalizeMaxTurns(values['max-turns']),
    instructions:
      values.instructions?.trim()
      || process.env.EVAL_SYSTEM_PROMPT?.trim()
      || DEFAULT_INSTRUCTIONS,
    sessionKey: values['session-key']?.trim() || undefined,
    sessionDir: resolveSessionDir(values['session-dir']),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid CLI arguments.');
  }

  return parsed.data;
};

const main = async (): Promise<void> => {
  const options = await parseCliOptions(process.argv.slice(2));

  const session = createSession();
  const savedHistory = await loadSessionHistory(options.sessionDir, options.sessionKey);
  if (savedHistory.length > 0) {
    session.history.push(...(savedHistory as typeof session.history));
  }

  const result = await runAgentEval({
    model: options.model,
    message: options.message,
    session,
    maxTurns: options.maxTurns,
    instructions: options.instructions,
  });

  await saveSessionHistory(options.sessionDir, options.sessionKey, session.history as unknown[]);

  const payload = {
    model: options.model,
    message: options.message,
    maxTurns: options.maxTurns,
    instructions: options.instructions,
    sessionKey: options.sessionKey ?? null,
    ...result,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
