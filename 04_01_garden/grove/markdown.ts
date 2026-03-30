import { marked } from "marked";
import matter from "gray-matter";
import { posix } from "node:path";
import type { ComparisonData, ComparisonProduct, Page, PageSeo } from "./types";

const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return asStringArray(value);
  if (typeof value !== "string") return undefined;

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function normalizeFilePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function filePathToSlug(filepath: string): string {
  const normalized = normalizeFilePath(filepath)
    .replace(/\.md$/i, "")
    .replace(/\/index$/i, "")
    .replace(/^\/+/, "");
  return normalized || "index";
}

function headingToAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultWikiLabel(rawTarget: string): string {
  const base = rawTarget.split("#")[0].trim();
  if (!base) return "section";

  const lastSegment = base
    .replace(/\.md$/i, "")
    .replace(/\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .pop();

  const normalized = (lastSegment ?? base).replace(/[-_]/g, " ").trim();
  return normalized || "link";
}

function resolveInternalLink(
  rawTarget: string,
  currentFilePath: string,
  currentSlug: string,
): { slug: string; anchor?: string } | undefined {
  const target = rawTarget.trim();
  if (!target || PROTOCOL_RE.test(target)) return undefined;

  const currentFileWithoutExt = normalizeFilePath(currentFilePath).replace(/\.md$/i, "");
  const currentDir = posix.dirname(currentFileWithoutExt);

  const hashIndex = target.indexOf("#");
  const pathPart = (hashIndex === -1 ? target : target.slice(0, hashIndex)).trim();
  const rawAnchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1).trim();
  const anchor = rawAnchor ? headingToAnchor(rawAnchor) : undefined;

  if (!pathPart) {
    return { slug: currentSlug, ...(anchor ? { anchor } : {}) };
  }

  let resolved = pathPart.replaceAll("\\", "/").trim();
  if (resolved.startsWith("vault/")) resolved = resolved.slice("vault/".length);
  if (resolved.startsWith("/")) resolved = resolved.slice(1);
  if (resolved.startsWith("./") || resolved.startsWith("../")) {
    resolved = posix.normalize(posix.join(currentDir, resolved));
  }

  resolved = resolved
    .replace(/\.md$/i, "")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");

  if (!resolved || resolved === ".") {
    return { slug: currentSlug, ...(anchor ? { anchor } : {}) };
  }
  if (resolved.startsWith("../")) return undefined;

  const slug = resolved.replace(/\/index$/i, "") || "index";
  return { slug, ...(anchor ? { anchor } : {}) };
}

function buildRelativeHref(currentSlug: string, targetSlug: string, anchor?: string): string {
  if (currentSlug === targetSlug && anchor) {
    return `#${anchor}`;
  }
  if (currentSlug === targetSlug) {
    return "#";
  }

  const fromDir = currentSlug === "index" ? "." : posix.dirname(currentSlug);
  const targetFile = `${targetSlug}.html`;
  const relativeHref = posix.relative(fromDir, targetFile) || targetFile;
  return anchor ? `${relativeHref}#${anchor}` : relativeHref;
}

function rewriteWikiLinks(
  content: string,
  currentFilePath: string,
  currentSlug: string,
): string {
  return content.replace(/(!)?\[\[([^[\]]+)\]\]/g, (match, _embed, inner: string) => {
    const [targetRaw, aliasRaw] = inner.split("|");
    const target = (targetRaw ?? "").trim();
    if (!target) return match;

    const resolved = resolveInternalLink(target, currentFilePath, currentSlug);
    if (!resolved) return match;

    const label = (aliasRaw ?? "").trim() || defaultWikiLabel(target);
    const href = buildRelativeHref(currentSlug, resolved.slug, resolved.anchor);
    return `[${label}](${href})`;
  });
}

function rewriteMarkdownMdLinks(
  content: string,
  currentFilePath: string,
  currentSlug: string,
): string {
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, targetWithSuffix: string, offset: number, source: string) => {
    if (offset > 0 && source[offset - 1] === "!") return match;

    const trimmedTarget = targetWithSuffix.trim();
    const firstSpace = trimmedTarget.indexOf(" ");
    const target = firstSpace === -1 ? trimmedTarget : trimmedTarget.slice(0, firstSpace);
    const suffix = firstSpace === -1 ? "" : trimmedTarget.slice(firstSpace);

    if (
      !target ||
      PROTOCOL_RE.test(target) ||
      target.startsWith("#") ||
      !/\.md(?:#.*)?$/i.test(target)
    ) {
      return match;
    }

    const resolved = resolveInternalLink(target, currentFilePath, currentSlug);
    if (!resolved) return match;

    const href = buildRelativeHref(currentSlug, resolved.slug, resolved.anchor);
    return `[${label}](${href}${suffix})`;
  });
}

function parseSeo(data: Record<string, unknown>): PageSeo | undefined {
  const seo: PageSeo = {
    title: asString(data.seo_title),
    description: asString(data.seo_description),
    canonical: asString(data.seo_canonical),
    image: asString(data.seo_image),
    keywords: asStringList(data.seo_keywords) ?? asStringList(data.keywords),
    noindex: asBoolean(data.seo_noindex) ?? asBoolean(data.noindex),
  };

  if (
    seo.title === undefined &&
    seo.description === undefined &&
    seo.canonical === undefined &&
    seo.image === undefined &&
    seo.keywords === undefined &&
    seo.noindex === undefined
  ) {
    return undefined;
  }

  return seo;
}

function parseProduct(value: unknown): ComparisonProduct | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const name = asString(obj.name);
  if (!name) return undefined;

  return {
    name,
    url: asString(obj.url),
    positioning: asString(obj.positioning),
    pricing: asString(obj.pricing),
    deployment: asString(obj.deployment),
    integrations: asStringArray(obj.integrations),
    key_features: asStringArray(obj.key_features),
    strengths: asStringArray(obj.strengths),
    risks: asStringArray(obj.risks),
    best_fit: asString(obj.best_fit),
  };
}

function parseComparison(value: unknown): ComparisonData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.products)) return undefined;

  const products = obj.products
    .map((product) => parseProduct(product))
    .filter((product): product is ComparisonProduct => product !== undefined);

  if (products.length === 0) return undefined;

  return {
    products,
    criteria: asStringArray(obj.criteria),
  };
}

function parseComparisonJson(value: unknown): ComparisonData | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parseComparison(parsed);
  } catch {
    return undefined;
  }
}

export function parse(filepath: string, raw: string): Page {
  const { data, content } = matter(raw);
  const metadata = data as Record<string, unknown>;
  const slug = filePathToSlug(filepath);
  const source = rewriteMarkdownMdLinks(
    rewriteWikiLinks(content, filepath, slug),
    filepath,
    slug,
  );
  const publish = asBoolean(metadata.publish);
  const draft = asBoolean(metadata.draft) ?? false;
  const seo = parseSeo(metadata);

  return {
    slug,
    title: data.title ?? slug.split("/").pop() ?? "Untitled",
    description: data.description,
    date: data.date instanceof Date
      ? data.date.toISOString().slice(0, 10)
      : typeof data.date === "string"
        ? data.date
        : undefined,
    template: asString(data.template),
    comparison: parseComparison(data.comparison) ?? parseComparisonJson(data.comparison_json),
    seo,
    published: publish !== false && !draft,
    listing: asBoolean(metadata.listing),
    listingPageSize: asNumber(metadata.listing_page_size),
    content: marked.parse(source, { async: false }) as string,
    raw: content,
  };
}
