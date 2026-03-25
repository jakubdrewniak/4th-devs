import { getPage, screenshot } from '../browser.js';
import { encodePngFileAsImageContent, saveNavigationArtifacts } from './artifacts.js';
import type { ToolOutput, ToolRegistry } from './types.js';

const ERROR_PATTERNS = ['page not found', 'sorry, we', '404', 'not available', 'access denied'];

const isLikelyErrorPage = (title: string, bodyText: string): boolean => {
  const text = `${title} ${bodyText.slice(0, 300)}`.toLowerCase();
  return ERROR_PATTERNS.some((pattern) => text.includes(pattern));
};

const handleNavigate = async (args: Record<string, unknown>): Promise<string> => {
  const page = getPage();
  const url = String(args.url);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(1500);

  const title = await page.title();
  const finalUrl = page.url();
  const bodyText = await page.innerText('body');

  if (isLikelyErrorPage(title, bodyText)) {
    return JSON.stringify({ title, url: finalUrl, status: 'error' });
  }

  await saveNavigationArtifacts(page, finalUrl, bodyText);
  return JSON.stringify({ title, url: finalUrl, status: 'ok' });
};

const handleEvaluate = async (args: Record<string, unknown>): Promise<string> => {
  const result = await getPage().evaluate(String(args.code));
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
};

const handleClick = async (args: Record<string, unknown>): Promise<string> => {
  const page = getPage();

  if (args.selector) {
    await page.click(String(args.selector), { timeout: 5000 });
  } else if (args.text) {
    await page.getByText(String(args.text), { exact: false }).first().click({ timeout: 5000 });
  } else {
    return 'Error: Provide selector or text';
  }

  await page.waitForTimeout(1500);
  return JSON.stringify({ title: await page.title(), url: page.url(), status: 'ok' });
};

const handleTypeText = async (args: Record<string, unknown>): Promise<string> => {
  const page = getPage();
  const selector = String(args.selector);

  await page.fill(selector, String(args.text), { timeout: 5000 });

  if (args.pressEnter) {
    await page.press(selector, 'Enter');
    await page.waitForTimeout(2000);
  }

  return JSON.stringify({ title: await page.title(), url: page.url(), status: 'ok' });
};

const handleScreenshot = async (args: Record<string, unknown>): Promise<ToolOutput> => {
  const filepath = await screenshot(args.name ? String(args.name) : undefined);
  return encodePngFileAsImageContent(filepath, 'low');
};

export const createBrowserTools = (): ToolRegistry => ({
  navigate: {
    description: 'Open a URL. Saves text + DOM structure to files. Returns title and URL status.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    handler: handleNavigate,
  },

  evaluate: {
    description: 'Run JS in the browser DOM. Most efficient extraction tool.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    handler: handleEvaluate,
  },

  click: {
    description: 'Click an element by CSS selector or visible text.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Visible text to click' },
      },
    },
    handler: handleClick,
  },

  type_text: {
    description: 'Type into an input field. Clears first.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        pressEnter: { type: 'boolean' },
      },
      required: ['selector', 'text'],
    },
    handler: handleTypeText,
  },

  take_screenshot: {
    description:
      'Capture the current viewport and return it as an image input for visual inspection.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional screenshot label' },
      },
    },
    handler: handleScreenshot,
  },
});
