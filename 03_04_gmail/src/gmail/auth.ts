import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import {
  GMAIL_CREDENTIALS_PATH,
  GMAIL_SCOPES,
  GMAIL_TOKEN_PATH,
  ROOT_DIR,
} from '../config.js';

type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

interface OAuthClientSecrets {
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
  web?: {
    client_id?: string;
    client_secret?: string;
  };
}

interface StoredToken {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

let credentialsPathCache: string | null = null;

const resolveCredentialsPath = async (): Promise<string> => {
  if (credentialsPathCache) return credentialsPathCache;

  const fromEnv = process.env.GMAIL_CREDENTIALS_PATH;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    credentialsPathCache = fromEnv.startsWith('/') ? fromEnv : resolve(ROOT_DIR, fromEnv);
    return credentialsPathCache;
  }

  try {
    await readFile(GMAIL_CREDENTIALS_PATH, 'utf-8');
    credentialsPathCache = GMAIL_CREDENTIALS_PATH;
    return credentialsPathCache;
  } catch {
    // continue with fallback discovery
  }

  const dir = dirname(GMAIL_CREDENTIALS_PATH);
  const files = await readdir(dir).catch(() => []);
  const fallback = files.find((name) => /^client_secret.*\.json$/i.test(name));

  if (fallback) {
    credentialsPathCache = resolve(dir, fallback);
    return credentialsPathCache;
  }

  throw new Error(
    'Google OAuth credentials file not found. Add credentials.json or set GMAIL_CREDENTIALS_PATH.',
  );
};

const readClientSecrets = async (): Promise<{ clientId: string; clientSecret: string }> => {
  const credentialsPath = await resolveCredentialsPath();
  let raw: OAuthClientSecrets;
  try {
    raw = JSON.parse(await readFile(credentialsPath, 'utf-8')) as OAuthClientSecrets;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read OAuth credentials (${message}).`);
  }

  const entry = raw.installed ?? raw.web;
  const clientId = entry?.client_id;
  const clientSecret = entry?.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error('credentials.json must include client_id and client_secret.');
  }

  return { clientId, clientSecret };
};

const loadSavedAuthClient = async (): Promise<GoogleOAuthClient | null> => {
  try {
    const data = JSON.parse(await readFile(GMAIL_TOKEN_PATH, 'utf-8')) as Partial<StoredToken>;
    if (!data.client_id || !data.client_secret || !data.refresh_token) return null;

    const auth = new google.auth.OAuth2(data.client_id, data.client_secret);
    auth.setCredentials({ refresh_token: data.refresh_token });
    return auth;
  } catch {
    return null;
  }
};

const saveRefreshToken = async (refreshToken: string): Promise<void> => {
  const { clientId, clientSecret } = await readClientSecrets();
  const payload: StoredToken = {
    type: 'authorized_user',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  };

  await mkdir(dirname(GMAIL_TOKEN_PATH), { recursive: true });
  await writeFile(GMAIL_TOKEN_PATH, JSON.stringify(payload, null, 2), 'utf-8');
};

const runInteractiveAuth = async (): Promise<GoogleOAuthClient> => {
  const credentialsPath = await resolveCredentialsPath();
  const auth = (await authenticate({
    scopes: GMAIL_SCOPES,
    keyfilePath: credentialsPath,
  })) as unknown as GoogleOAuthClient;

  const refreshToken = auth.credentials.refresh_token;
  if (refreshToken) {
    await saveRefreshToken(refreshToken);
  }

  return auth;
};

export const getGmailAuthClient = async (): Promise<GoogleOAuthClient> => {
  const cached = await loadSavedAuthClient();
  if (cached) return cached;
  return runInteractiveAuth();
};

export const authenticateGmail = async (): Promise<{ tokenPath: string }> => {
  const auth = await runInteractiveAuth();
  const refreshToken = auth.credentials.refresh_token;
  if (!refreshToken) {
    throw new Error('OAuth completed but refresh token was not returned.');
  }

  return { tokenPath: GMAIL_TOKEN_PATH };
};
