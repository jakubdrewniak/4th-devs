import matter from "gray-matter";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMarkdownBlocks, serializeMarkdownBlocks } from "./markdown.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SRC_DIR, "..");
const WORKSPACE_ROOT = join(PROJECT_ROOT, "workspace");
const DOCUMENTS_ROOT = join(WORKSPACE_ROOT, "documents");
const PROMPTS_ROOT = join(WORKSPACE_ROOT, "prompts");
const REVIEWS_ROOT = join(WORKSPACE_ROOT, "reviews");
const AGENTS_ROOT = join(WORKSPACE_ROOT, "system/agents");

const toPosix = (value) => value.replaceAll("\\", "/");

const projectPathFromAbsolute = (absolutePath) => (
  toPosix(relative(PROJECT_ROOT, absolutePath))
);

const workspacePathFromAbsolute = (absolutePath) => (
  toPosix(relative(WORKSPACE_ROOT, absolutePath))
);

const ensureWithin = (root, projectPath) => {
  const absolutePath = resolve(PROJECT_ROOT, projectPath);
  const absoluteRoot = resolve(root);

  if (!absolutePath.startsWith(absoluteRoot)) {
    throw new Error(`Path is outside the allowed directory: ${projectPath}`);
  }

  return absolutePath;
};

const ensureWithinWorkspace = (workspacePath) => {
  const absolutePath = resolve(WORKSPACE_ROOT, workspacePath);
  const absoluteRoot = resolve(WORKSPACE_ROOT);

  if (!absolutePath.startsWith(absoluteRoot)) {
    throw new Error(`Path is outside the workspace: ${workspacePath}`);
  }

  return absolutePath;
};

const normalizePromptPath = (projectPath) => {
  const normalized = toPosix(String(projectPath ?? "").trim());

  if (normalized.startsWith("prompts/")) {
    return normalized.replace(/^prompts\//, "workspace/prompts/");
  }

  return normalized;
};

const normalizeContextFiles = (value) => (
  Array.isArray(value)
    ? value
      .filter((entry) => typeof entry === "string" && entry.trim())
      .map((entry) => toPosix(entry.trim()).replace(/^workspace\//, ""))
    : []
);

const readMarkdown = async (absolutePath) => {
  const raw = await readFile(absolutePath, "utf-8");
  const parsed = matter(raw);

  return {
    raw,
    frontmatter: parsed.data ?? {},
    content: parsed.content.trim(),
  };
};

const walkMarkdownFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(absolutePath);
    }
  }

  return files;
};

const createSummary = (content, fallback) => {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine?.slice(0, 120) ?? fallback;
};

export const listDocuments = async () => {
  const files = await walkMarkdownFiles(DOCUMENTS_ROOT);

  const documents = await Promise.all(files.map(async (absolutePath) => {
    const metadata = await readMarkdown(absolutePath);
    const fileStat = await stat(absolutePath);

    return {
      path: projectPathFromAbsolute(absolutePath),
      title: metadata.frontmatter.title ?? absolutePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "Untitled",
      summary: metadata.frontmatter.summary ?? createSummary(metadata.content, "Markdown document"),
      frontmatter: metadata.frontmatter,
      updatedAt: fileStat.mtime.toISOString(),
    };
  }));

  return documents.sort((left, right) => left.path.localeCompare(right.path));
};

export const listPrompts = async () => {
  const files = await walkMarkdownFiles(PROMPTS_ROOT);

  const prompts = await Promise.all(files.map(async (absolutePath) => {
    const metadata = await readMarkdown(absolutePath);
    const contextFiles = normalizeContextFiles(metadata.frontmatter.contextFiles);

    return {
      path: projectPathFromAbsolute(absolutePath),
      title: metadata.frontmatter.title ?? absolutePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "Untitled",
      description: metadata.frontmatter.description ?? createSummary(metadata.content, "Review prompt"),
      modes: Array.isArray(metadata.frontmatter.modes) && metadata.frontmatter.modes.length > 0
        ? metadata.frontmatter.modes
        : ["paragraph", "at_once"],
      contextFiles,
      frontmatter: metadata.frontmatter,
      body: metadata.content,
    };
  }));

  return prompts.sort((left, right) => left.path.localeCompare(right.path));
};

export const loadDocument = async (projectPath) => {
  const absolutePath = ensureWithin(DOCUMENTS_ROOT, projectPath);
  const parsed = await readMarkdown(absolutePath);
  const blocks = parseMarkdownBlocks(parsed.content);

  return {
    path: projectPathFromAbsolute(absolutePath),
    title: parsed.frontmatter.title ?? blocks.find((block) => block.type === "heading")?.text ?? "Untitled",
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    blocks,
  };
};

export const saveDocument = async (document) => {
  const absolutePath = ensureWithin(DOCUMENTS_ROOT, document.path);
  const content = serializeMarkdownBlocks(document.blocks);
  const raw = matter.stringify(content, document.frontmatter ?? {});

  await writeFile(absolutePath, raw, "utf-8");

  return {
    ...document,
    content,
  };
};

export const loadPrompt = async (projectPath) => {
  const normalizedPath = normalizePromptPath(projectPath);
  const absolutePath = ensureWithin(PROMPTS_ROOT, normalizedPath);
  const parsed = await readMarkdown(absolutePath);
  const contextFiles = normalizeContextFiles(parsed.frontmatter.contextFiles);
  const context = await Promise.all(contextFiles.map(async (workspacePath) => {
    const absoluteContextPath = ensureWithinWorkspace(workspacePath);
    const content = await readFile(absoluteContextPath, "utf-8");

    return {
      path: `workspace/${workspacePathFromAbsolute(absoluteContextPath)}`,
      content,
    };
  }));

  return {
    path: projectPathFromAbsolute(absolutePath),
    title: parsed.frontmatter.title ?? "Untitled prompt",
    description: parsed.frontmatter.description ?? "",
    contextFiles,
    context,
    frontmatter: parsed.frontmatter,
    body: parsed.content,
  };
};

export const loadAgent = async (name) => {
  const absolutePath = join(AGENTS_ROOT, `${name}.md`);
  const parsed = await readMarkdown(absolutePath);

  return {
    name: parsed.frontmatter.title ?? name,
    description: parsed.frontmatter.description ?? "",
    model: parsed.frontmatter.model ?? "gpt-5.4",
    instructions: parsed.content,
  };
};

export const saveReview = async (review) => {
  await mkdir(REVIEWS_ROOT, { recursive: true });
  const absolutePath = join(REVIEWS_ROOT, `${review.id}.json`);
  await writeFile(absolutePath, JSON.stringify(review, null, 2), "utf-8");
  return review;
};

export const loadReview = async (reviewId) => {
  const absolutePath = join(REVIEWS_ROOT, `${reviewId}.json`);
  const raw = await readFile(absolutePath, "utf-8");
  return JSON.parse(raw);
};

export const hydrateReviewForDocument = (document, review) => {
  if (!document || !review) return review;

  const blockMap = new Map(document.blocks.map((b) => [b.id, b]));

  for (const c of review.comments) {
    if (!["open", "accepted"].includes(c.status)) continue;

    const block = blockMap.get(c.blockId);
    if (!block) continue;

    const storedValid = Number.isInteger(c.start)
      && Number.isInteger(c.end)
      && block.text.slice(c.start, c.end) === c.quote;

    if (storedValid) continue;

    const idx = block.text.indexOf(c.quote);
    if (idx !== -1) {
      c.start = idx;
      c.end = idx + c.quote.length;
    }
  }

  return review;
};

export const loadLatestReviewForDocument = async (documentPath) => {
  try {
    const files = await readdir(REVIEWS_ROOT);
    const reviewFiles = files.filter((file) => file.endsWith(".json"));
    const reviews = [];

    for (const file of reviewFiles) {
      const review = JSON.parse(await readFile(join(REVIEWS_ROOT, file), "utf-8"));

      if (review.documentPath === documentPath) {
        reviews.push(review);
      }
    }

    reviews.sort((left, right) => (
      new Date(right.updatedAt ?? right.createdAt).getTime()
      - new Date(left.updatedAt ?? left.createdAt).getTime()
    ));

    return reviews[0] ?? null;
  } catch {
    return null;
  }
};
