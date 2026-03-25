import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Page } from 'playwright';
import type { ImageContent } from './types.js';

const PAGES_DIR = join(dirname(dirname(Bun.main)), 'data', 'pages');

const STRUCTURE_SCRIPT = `(() => {
  const walk = (el, depth = 0) => {
    if (depth > 6) return [];
    const results = [];
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (['script','style','noscript','svg','path','link','meta'].includes(tag)) continue;
      const id = child.id ? '#' + child.id : '';
      const cls = [...child.classList].slice(0, 3).join('.');
      const testId = child.getAttribute('data-testid') || '';
      const role = child.getAttribute('role') || '';
      const aria = child.getAttribute('aria-label')?.slice(0, 40) || '';
      const href = child.getAttribute('href')?.slice(0, 60) || '';
      const text = child.childNodes.length <= 2
        ? (child.textContent || '').trim().slice(0, 50).replace(/\\n/g, ' ')
        : '';
      const indent = '  '.repeat(depth);
      let line = indent + '<' + tag;
      if (id) line += id;
      if (cls) line += '.' + cls;
      if (testId) line += ' [data-testid="' + testId + '"]';
      if (role) line += ' [role="' + role + '"]';
      if (aria) line += ' [aria-label="' + aria + '"]';
      if (href) line += ' href="' + href + '"';
      line += '>';
      if (text) line += ' ' + text;
      results.push(line);
      results.push(...walk(child, depth + 1));
    }
    return results;
  };
  return walk(document.body).join('\\n');
})()`;

const slugFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/[^a-z0-9]/gi, '_').slice(0, 60) || 'page';
  } catch {
    return 'page';
  }
};

const ensureArtifactsDir = async (): Promise<void> => {
  await mkdir(PAGES_DIR, { recursive: true });
};

export const savePageText = async (content: string, url: string): Promise<string> => {
  await ensureArtifactsDir();
  const slug = slugFromUrl(url);
  const textPath = join(PAGES_DIR, `${slug}.txt`);
  const lines = content.split('\n');
  const numbered = lines.map((line, idx) => `${String(idx + 1).padStart(4, ' ')}| ${line}`).join('\n');
  await writeFile(textPath, numbered, 'utf-8');
  return `pages/${slug}.txt`;
};

export const savePageStructure = async (page: Page, url: string): Promise<string> => {
  await ensureArtifactsDir();
  const struct = (await page.evaluate(STRUCTURE_SCRIPT)) as string;
  const slug = slugFromUrl(url);
  const structPath = join(PAGES_DIR, `${slug}.struct.txt`);
  await writeFile(structPath, struct, 'utf-8');
  return `pages/${slug}.struct.txt`;
};

export const saveNavigationArtifacts = async (page: Page, url: string, bodyText: string): Promise<void> => {
  await savePageText(bodyText, url);
  await savePageStructure(page, url);
};

export const encodePngFileAsImageContent = async (
  filepath: string,
  detail: ImageContent['detail'] = 'low',
): Promise<ImageContent[]> => {
  const buffer = await readFile(filepath);
  return [
    {
      type: 'input_image',
      image_url: `data:image/png;base64,${buffer.toString('base64')}`,
      detail,
    },
  ];
};
