import { join, posix } from "node:path";
import type { ComparisonData, ComparisonProduct, Menu, Page } from "./types";

export interface ListingContext {
  children: Page[];
  currentPage: number;
  totalPages: number;
  parentSlug: string;
}

const TEMPLATES_DIR = join(import.meta.dir, "templates");
const layout = await Bun.file(join(TEMPLATES_DIR, "layout.html")).text();

function relativePrefix(slug: string): string {
  const depth = slug.split("/").length - 1;
  return depth > 0 ? "../".repeat(depth) : "./";
}

function slugToRelativeHref(fromSlug: string, toSlug: string): string {
  const fromDir = fromSlug.includes("/") ? posix.dirname(fromSlug) : ".";
  return posix.relative(fromDir, `${toSlug}.html`) || `${toSlug}.html`;
}

function renderListingItems(children: Page[], fromSlug: string): string {
  return children
    .map((child) => {
      const href = slugToRelativeHref(fromSlug, child.slug);
      const desc = child.description
        ? `<p class="listing-desc">${escapeHtml(child.description)}</p>`
        : "";
      const date = child.date
        ? `<time class="listing-date">${escapeHtml(child.date)}</time>`
        : "";
      return [
        '<article class="listing-item">',
        `<a class="listing-link" href="${href}">${escapeHtml(child.title)}</a>`,
        desc,
        date,
        "</article>",
      ].join("");
    })
    .join("\n");
}

function renderPagination(
  currentPage: number,
  totalPages: number,
  fromSlug: string,
  parentSlug: string,
): string {
  const pageSlug = (n: number) =>
    n === 1 ? parentSlug : `${parentSlug}/page/${n}`;

  const prev =
    currentPage > 1
      ? `<a href="${slugToRelativeHref(fromSlug, pageSlug(currentPage - 1))}" class="pagination-prev">← Newer</a>`
      : '<span class="pagination-placeholder"></span>';

  const next =
    currentPage < totalPages
      ? `<a href="${slugToRelativeHref(fromSlug, pageSlug(currentPage + 1))}" class="pagination-next">Older →</a>`
      : '<span class="pagination-placeholder"></span>';

  return [
    '<nav class="pagination">',
    prev,
    `<span class="pagination-info">${currentPage} / ${totalPages}</span>`,
    next,
    "</nav>",
  ].join("\n");
}

function injectListing(content: string, listing: ListingContext, slug: string): string {
  const items = renderListingItems(listing.children, slug);
  const pagination =
    listing.totalPages > 1
      ? renderPagination(listing.currentPage, listing.totalPages, slug, listing.parentSlug)
      : "";
  return `${content}\n<section class="listing">\n${items}\n</section>\n${pagination}`;
}

function renderNav(menu: Menu, currentSlug: string): string {
  const prefix = relativePrefix(currentSlug);
  return menu.items
    .map((item) => {
      const href = item.path === "/" ? `${prefix}index.html` : `${prefix}${item.path.slice(1)}.html`;
      const itemSlug = item.path === "/" ? "index" : item.path.slice(1);
      const active = currentSlug === itemSlug || currentSlug.startsWith(`${itemSlug}/`);
      return `<a href="${href}"${active ? ' class="active"' : ""}>${item.label}</a>`;
    })
    .join("\n      ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSeoMeta(page: Page): string {
  const seoTitle = page.seo?.title ?? page.title;
  const seoDescription = page.seo?.description ?? page.description;
  const canonical = page.seo?.canonical;
  const image = page.seo?.image;
  const keywords = page.seo?.keywords;
  const noindex = page.seo?.noindex;

  return [
    seoDescription
      ? `<meta name="description" content="${escapeHtml(seoDescription)}">`
      : "",
    keywords && keywords.length > 0
      ? `<meta name="keywords" content="${escapeHtml(keywords.join(", "))}">`
      : "",
    noindex ? '<meta name="robots" content="noindex, nofollow">' : "",
    canonical
      ? `<link rel="canonical" href="${escapeHtml(canonical)}">`
      : "",
    `<meta property="og:title" content="${escapeHtml(seoTitle)}">`,
    seoDescription
      ? `<meta property="og:description" content="${escapeHtml(seoDescription)}">`
      : "",
    '<meta property="og:type" content="article">',
    canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : "",
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(seoTitle)}">`,
    seoDescription
      ? `<meta name="twitter:description" content="${escapeHtml(seoDescription)}">`
      : "",
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : "",
  ]
    .filter(Boolean)
    .join("\n  ");
}

function toList(items?: string[]): string {
  if (!items || items.length === 0) return "Not listed";
  return items.map((item) => escapeHtml(item)).join(", ");
}

function criteriaEntries(comparison: ComparisonData): Array<{ key: string; label: string }> {
  const defaults: Array<{ key: string; label: string }> = [
    { key: "positioning", label: "Positioning" },
    { key: "pricing", label: "Pricing" },
    { key: "deployment", label: "Deployment" },
    { key: "key_features", label: "Key Features" },
    { key: "integrations", label: "Integrations" },
    { key: "strengths", label: "Strengths" },
    { key: "risks", label: "Risks" },
    { key: "best_fit", label: "Best Fit" },
  ];

  if (!comparison.criteria || comparison.criteria.length === 0) return defaults;

  const allowed = new Map(defaults.map((entry) => [entry.key, entry]));
  const fromFrontmatter = comparison.criteria
    .map((key) => key.trim().toLowerCase().replaceAll(" ", "_"))
    .map((key) => allowed.get(key))
    .filter((entry): entry is { key: string; label: string } => entry !== undefined);

  return fromFrontmatter.length > 0 ? fromFrontmatter : defaults;
}

function productValue(product: ComparisonProduct, key: string): string {
  const value: string | string[] | undefined =
    key === "name"
      ? product.name
      : key === "url"
        ? product.url
        : key === "positioning"
          ? product.positioning
          : key === "pricing"
            ? product.pricing
            : key === "deployment"
              ? product.deployment
              : key === "integrations"
                ? product.integrations
                : key === "key_features"
                  ? product.key_features
                  : key === "strengths"
                    ? product.strengths
                    : key === "risks"
                      ? product.risks
                      : key === "best_fit"
                        ? product.best_fit
                        : undefined;

  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) return toList(value.filter((v): v is string => typeof v === "string"));
  return "Not listed";
}

function renderProductCards(comparison: ComparisonData): string {
  return comparison.products
    .map((product) => {
      const title = escapeHtml(product.name);
      const link = product.url
        ? `<a class="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-4" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(product.url)}</a>`
        : '<span class="text-xs text-zinc-400">No official URL listed</span>';

      return [
        '<article class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-lg shadow-black/20">',
        `<h3 class="text-lg font-semibold tracking-tight text-zinc-100">${title}</h3>`,
        `<div class="mt-1">${link}</div>`,
        '<dl class="mt-4 space-y-2 text-sm">',
        `<div><dt class="font-medium text-zinc-300">Positioning</dt><dd class="text-zinc-200">${productValue(product, "positioning")}</dd></div>`,
        `<div><dt class="font-medium text-zinc-300">Pricing</dt><dd class="text-zinc-200">${productValue(product, "pricing")}</dd></div>`,
        `<div><dt class="font-medium text-zinc-300">Best Fit</dt><dd class="text-zinc-200">${productValue(product, "best_fit")}</dd></div>`,
        "</dl>",
        "</article>",
      ].join("");
    })
    .join("\n");
}

function renderComparisonTable(comparison: ComparisonData): string {
  const criteria = criteriaEntries(comparison);
  const header = comparison.products
    .map((product) => `<th class="px-4 py-3 text-left font-semibold text-zinc-200">${escapeHtml(product.name)}</th>`)
    .join("");

  const rows = criteria
    .map((criterion) => {
      const cells = comparison.products
        .map((product) => `<td class="px-4 py-3 align-top text-zinc-300">${productValue(product, criterion.key)}</td>`)
        .join("");
      return `<tr class="border-t border-zinc-800"><th class="px-4 py-3 text-left text-zinc-100">${criterion.label}</th>${cells}</tr>`;
    })
    .join("\n");

  return [
    '<div class="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">',
    '<table class="min-w-full text-sm">',
    '<thead class="bg-zinc-900/90">',
    `<tr><th class="px-4 py-3 text-left font-semibold text-zinc-100">Criterion</th>${header}</tr>`,
    "</thead>",
    `<tbody>${rows}</tbody>`,
    "</table>",
    "</div>",
  ].join("");
}

function renderComparisonUi(comparison: ComparisonData): string {
  const cards = renderProductCards(comparison);
  const table = renderComparisonTable(comparison);
  const count = comparison.products.length;

  return [
    '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
    '<section class="not-prose my-8 rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/30">',
    '<header class="border-b border-zinc-800 px-6 py-5">',
    '<p class="text-xs uppercase tracking-[0.18em] text-zinc-400">Product Comparison</p>',
    `<h2 class="mt-2 text-2xl font-bold tracking-tight text-zinc-100">${count} Products Overview</h2>`,
    "</header>",
    '<div class="space-y-6 px-6 py-6">',
    `<div class="grid gap-4 md:grid-cols-${Math.min(Math.max(count, 1), 3)}">${cards}</div>`,
    table,
    '<aside class="rounded-xl border border-emerald-900/60 bg-emerald-950/40 p-4 text-sm text-emerald-100">',
    '<strong class="font-semibold">Verdict tip:</strong> Use the matrix for fast elimination, then validate the final pick against team workflow and integration constraints.',
    "</aside>",
    "</div>",
    "</section>",
  ].join("\n");
}

function injectComparisonUi(content: string, comparison: ComparisonData): string {
  const ui = renderComparisonUi(comparison);
  if (content.includes("<p>[[comparison_ui]]</p>")) {
    return content.replace("<p>[[comparison_ui]]</p>", ui);
  }
  if (content.includes("[[comparison_ui]]")) {
    return content.replace("[[comparison_ui]]", ui);
  }
  return `${ui}\n${content}`;
}

export function render(page: Page, menu: Menu, listing?: ListingContext): string {
  const prefix = relativePrefix(page.slug);
  const seoTitle = page.seo?.title ?? page.title;
  const documentTitle = `${seoTitle} — ${menu.title}`;
  const seoMeta = renderSeoMeta(page);

  let content =
    page.template === "product-compare-dark" && page.comparison
      ? injectComparisonUi(page.content, page.comparison)
      : page.content;

  if (listing && listing.children.length > 0) {
    content = injectListing(content, listing, page.slug);
  }

  return layout
    .replace("{{document_title}}", escapeHtml(documentTitle))
    .replace("{{seo_meta}}", seoMeta)
    .replace(/\{\{title\}\}/g, escapeHtml(page.title))
    .replace(/\{\{site_title\}\}/g, escapeHtml(menu.title))
    .replace("{{base}}", prefix)
    .replace("{{css_path}}", `${prefix}styles/main.css`)
    .replace("{{nav}}", renderNav(menu, page.slug))
    .replace("{{content}}", content);
}
