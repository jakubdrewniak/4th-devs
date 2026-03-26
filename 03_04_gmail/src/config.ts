import { resolveModelForProvider } from '../../config.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(SRC_DIR, '..');

export const MODEL = resolveModelForProvider(process.env.MODEL ?? 'gpt-5.2');

const parseCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseBoolean = (value: string | undefined): boolean =>
  /^(1|true|yes|on)$/i.test((value ?? '').trim());

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
];
export const GMAIL_SEND_WHITELIST = parseCsv(process.env.GMAIL_SEND_WHITELIST);
export const EVAL_MOCK_GMAIL = parseBoolean(process.env.EVAL_MOCK_GMAIL);
export const GMAIL_CREDENTIALS_PATH = resolve(ROOT_DIR, 'credentials.json');
export const GMAIL_TOKEN_PATH = resolve(ROOT_DIR, '.auth', 'gmail-token.json');
