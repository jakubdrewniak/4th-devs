import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const ROOT = dirname(dirname(Bun.main));
const SESSION_PATH = join(ROOT, 'data', 'session.json');
const SCREENSHOTS_DIR = join(ROOT, 'data', 'screenshots');
const DATA_DIR = join(ROOT, 'data');

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

let session: BrowserSession | null = null;

const hasSession = (): boolean => existsSync(SESSION_PATH);

const loadStorageState = async (): Promise<string | undefined> =>
  hasSession() ? SESSION_PATH : undefined;

const saveStorageState = async (context: BrowserContext): Promise<void> => {
  await mkdir(DATA_DIR, { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`  [browser] Session saved to ${SESSION_PATH}`);
};

export const launch = async (options: { headless: boolean }): Promise<BrowserSession> => {
  if (session) return session;

  const storagePath = options.headless ? await loadStorageState() : undefined;

  const browser = await chromium.launch({
    headless: options.headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    ...(storagePath ? { storageState: storagePath } : {}),
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] ?? await context.newPage();
  session = { browser, context, page };
  return session;
};

export const getPage = (): Page => {
  if (!session) throw new Error('Browser not launched. Call launch() first.');
  return session.page;
};

export const saveSession = async (): Promise<void> => {
  if (!session) throw new Error('No active browser session');
  await saveStorageState(session.context);
};

export const close = async (): Promise<void> => {
  if (!session) return;
  await session.browser.close();
  session = null;
};

export const screenshot = async (name?: string): Promise<string> => {
  const page = getPage();
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  const filename = name ?? `screenshot-${Date.now()}`;
  const filepath = `${SCREENSHOTS_DIR}/${filename}.png`;
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
};

export const sessionExists = hasSession;
