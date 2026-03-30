import { readdir, rm, mkdir, cp } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "./markdown";
import { render, type ListingContext } from "./template";
import type { Menu, Page } from "./types";

const DEFAULT_PAGE_SIZE = 20;

const ROOT = import.meta.dir + "/..";
const VAULT = join(ROOT, "vault");
const DIST = join(ROOT, "dist");
const STYLES_SRC = join(import.meta.dir, "styles");
const MENU_PATH = join(ROOT, "menu.json");

async function collectMarkdown(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name === "system") continue;
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdown(full)));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function sortPages(pages: Page[]): Page[] {
  return [...pages].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

async function writeFile(outPath: string, html: string): Promise<void> {
  await mkdir(join(outPath, ".."), { recursive: true });
  await Bun.write(outPath, html);
}

async function build() {
  const start = performance.now();

  const menu: Menu = await Bun.file(MENU_PATH).json();

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(STYLES_SRC, join(DIST, "styles"), { recursive: true });

  const files = await collectMarkdown(VAULT);

  // Parse all pages first so we can build the children map
  let skipped = 0;
  const pages: Page[] = [];
  for (const file of files) {
    const raw = await Bun.file(file).text();
    const page = parse(relative(VAULT, file), raw);
    if (page.published) {
      pages.push(page);
    } else {
      skipped++;
    }
  }

  // Map each section slug to its immediate published children
  const childrenMap = new Map<string, Page[]>();
  for (const page of pages) {
    const parts = page.slug.split("/");
    if (parts.length < 2) continue;
    const parent = parts.slice(0, -1).join("/");
    const existing = childrenMap.get(parent) ?? [];
    childrenMap.set(parent, [...existing, page]);
  }
  for (const [key, children] of childrenMap) {
    childrenMap.set(key, sortPages(children));
  }

  let count = 0;
  for (const page of pages) {
    const children = childrenMap.get(page.slug) ?? [];

    if (page.listing && children.length > 0) {
      const pageSize = page.listingPageSize ?? DEFAULT_PAGE_SIZE;
      const chunks = chunkArray(children, pageSize);

      for (let i = 0; i < chunks.length; i++) {
        const pageNum = i + 1;
        const virtualSlug = pageNum === 1 ? page.slug : `${page.slug}/page/${pageNum}`;
        const listing: ListingContext = {
          children: chunks[i],
          currentPage: pageNum,
          totalPages: chunks.length,
          parentSlug: page.slug,
        };
        const html = render({ ...page, slug: virtualSlug }, menu, listing);
        await writeFile(join(DIST, `${virtualSlug}.html`), html);
        count++;
      }
    } else {
      const html = render(page, menu);
      await writeFile(join(DIST, `${page.slug}.html`), html);
      count++;
    }
  }

  const ms = (performance.now() - start).toFixed(0);
  const skippedMsg = skipped > 0 ? ` (${skipped} skipped)` : "";
  console.log(`grove: ${count} pages built${skippedMsg} in ${ms}ms → dist/`);
}

build();
