import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseInline } from "marked";

const processor = unified().use(remarkParse).use(remarkGfm);

/* ── Helpers ─────────────────────────────────────────── */

const rawSlice = (source, node) =>
  source.slice(node.position.start.offset, node.position.end.offset);

const joinLines = (text) =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");

const stripHeadingPrefix = (raw) =>
  raw.replace(/^#{1,6}\s+/, "");

const stripBlockquoteLines = (raw) =>
  raw.split("\n").map((l) => l.replace(/^\s*>\s?/, "")).join("\n");

const renderHtml = (text) => {
  try {
    return parseInline(text);
  } catch {
    return text;
  }
};

const createBlock = (type, text, meta = {}, reviewable = true) => ({
  id: "",
  order: -1,
  type,
  text,
  html: reviewable ? renderHtml(text) : "",
  meta,
  reviewable,
});

const withIdentity = (blocks) =>
  blocks.map((block, index) => ({
    ...block,
    id: `b${index + 1}`,
    order: index,
  }));

/* ── List processing (handles nesting) ───────────────── */

const processListItems = (listNode, source, blocks, depth = 0) => {
  for (const item of listNode.children) {
    if (item.type !== "listItem") continue;

    const paragraph = item.children?.find((c) => c.type === "paragraph");
    const text = paragraph ? joinLines(rawSlice(source, paragraph)) : "";
    const raw = rawSlice(source, item);
    const markerMatch = raw.match(/^\s*([-*+]|\d+\.)\s/);
    const marker = markerMatch
      ? markerMatch[1]
      : (listNode.ordered ? `${listNode.start ?? 1}.` : "-");

    if (text) {
      blocks.push(createBlock("list_item", text, {
        list: listNode.ordered ? "ordered" : "bullet",
        marker,
        depth,
        checked: item.checked ?? null,
      }));
    }

    for (const child of item.children ?? []) {
      if (child.type === "list") {
        processListItems(child, source, blocks, depth + 1);
      }
    }
  }
};

/* ── AST → blocks ────────────────────────────────────── */

const nodeToBlocks = (node, source, blocks) => {
  switch (node.type) {
    case "heading": {
      const text = stripHeadingPrefix(rawSlice(source, node)).trim();
      blocks.push(createBlock("heading", text, { level: node.depth }));
      break;
    }

    case "paragraph": {
      const text = joinLines(rawSlice(source, node));
      blocks.push(createBlock("paragraph", text));
      break;
    }

    case "blockquote": {
      const stripped = stripBlockquoteLines(rawSlice(source, node));
      const text = joinLines(stripped);
      blocks.push(createBlock("blockquote", text));
      break;
    }

    case "list": {
      processListItems(node, source, blocks);
      break;
    }

    case "code": {
      blocks.push(createBlock("code", rawSlice(source, node), {}, false));
      break;
    }

    case "thematicBreak": {
      blocks.push(createBlock("thematic_break", "---", {}, false));
      break;
    }

    case "table": {
      blocks.push(createBlock("table", rawSlice(source, node), {}, false));
      break;
    }

    case "html": {
      blocks.push(createBlock("html_block", rawSlice(source, node), {}, false));
      break;
    }

    default:
      break;
  }
};

/* ── Public API ──────────────────────────────────────── */

export const parseMarkdownBlocks = (content) => {
  const tree = processor.parse(content);
  const blocks = [];

  for (const node of tree.children) {
    nodeToBlocks(node, content, blocks);
  }

  return withIdentity(blocks);
};

/* ── Serialization (blocks → markdown) ───────────────── */

const blockToMarkdown = (block) => {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.meta.level ?? 1)} ${block.text}`;
    case "list_item": {
      const indent = "  ".repeat(block.meta.depth ?? 0);
      const prefix = block.meta.checked === true
        ? "[x] "
        : block.meta.checked === false
          ? "[ ] "
          : "";
      return `${indent}${block.meta.marker ?? "-"} ${prefix}${block.text}`;
    }
    case "blockquote":
      return `> ${block.text}`;
    case "code":
    case "table":
    case "html_block":
      return block.text;
    case "thematic_break":
      return "---";
    case "paragraph":
    default:
      return block.text;
  }
};

export const serializeMarkdownBlocks = (blocks) => {
  const parts = [];
  let previous = null;

  for (const block of blocks) {
    const markdown = blockToMarkdown(block);
    if (!markdown) continue;

    if (previous) {
      const sameList = previous.type === "list_item"
        && block.type === "list_item"
        && previous.meta.list === block.meta.list;

      parts.push(sameList ? "\n" : "\n\n");
    }

    parts.push(markdown);
    previous = block;
  }

  return parts.join("");
};

/* ── Range utilities (unchanged — work on raw text) ──── */

export const findQuoteRange = (text, quote) => {
  const needle = quote.trim();

  if (!needle) {
    return { error: "Quote must be a non-empty string." };
  }

  const positions = [];
  let cursor = text.indexOf(needle);

  while (cursor !== -1) {
    positions.push(cursor);
    cursor = text.indexOf(needle, cursor + 1);
  }

  if (positions.length === 0) {
    return { error: "Quote was not found in the selected block." };
  }

  if (positions.length > 1) {
    return { error: `Quote appears ${positions.length} times. Use a longer quote.` };
  }

  return {
    start: positions[0],
    end: positions[0] + needle.length,
  };
};

export const resolveCommentRange = (text, comment) => {
  if (
    Number.isInteger(comment.start)
    && Number.isInteger(comment.end)
    && text.slice(comment.start, comment.end) === comment.quote
  ) {
    return { start: comment.start, end: comment.end };
  }

  return findQuoteRange(text, comment.quote);
};
