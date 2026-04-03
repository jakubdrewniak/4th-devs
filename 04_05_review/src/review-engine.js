import { randomUUID } from "node:crypto";

import { complete } from "./api.js";
import { runAgent } from "./agent.js";
import { resolveCommentRange, serializeMarkdownBlocks } from "./markdown.js";
import {
  loadAgent,
  loadDocument,
  loadPrompt,
  loadReview,
  saveDocument,
  saveReview,
} from "./store.js";
import { createReviewTools } from "./tools.js";

const REVIEWABLE_TYPES = new Set(["heading", "paragraph", "list_item", "blockquote"]);
const PARAGRAPH_REVIEW_CONCURRENCY = 4;
const SUMMARY_COMMENT_LIMIT = 10;

const formatBlock = (block) => [
  `[${block.id}] ${block.type}`,
  block.text,
].join("\n");

const formatPromptContext = (prompt) => {
  const entries = Array.isArray(prompt.context) ? prompt.context : [];
  if (entries.length === 0) return "";

  return [
    "Prompt context files:",
    ...entries.flatMap((entry) => [
      `File: ${entry.path}`,
      entry.content.trim(),
      "",
    ]),
  ].join("\n").trim();
};

const buildInstructions = (agent, prompt) => [
  agent.instructions.trim(),
  "",
  "Selected prompt frontmatter:",
  JSON.stringify(prompt.frontmatter ?? {}, null, 2),
  "",
  "Selected prompt body:",
  prompt.body.trim(),
  ...(formatPromptContext(prompt)
    ? [
        "",
        formatPromptContext(prompt),
      ]
    : []),
].join("\n");

const buildAtOnceInput = (document, prompt) => {
  const blocks = document.blocks
    .filter((block) => block.reviewable && REVIEWABLE_TYPES.has(block.type))
    .map(formatBlock)
    .join("\n\n");

  return [
    `Review mode: at_once`,
    `Document path: ${document.path}`,
    `Document title: ${document.title}`,
    "",
    "Document frontmatter:",
    JSON.stringify(document.frontmatter ?? {}, null, 2),
    "",
    `Prompt title: ${prompt.title}`,
    `Prompt description: ${prompt.description}`,
    "",
    "Reviewable blocks:",
    blocks,
    "",
    "Use tools for comments. Keep the pass focused and avoid nitpicks.",
  ].join("\n");
};

const buildParagraphInput = (document, prompt, block, customMessage = "") => {
  const note = customMessage?.trim();

  return [
    "Review mode: paragraph",
    `Document path: ${document.path}`,
    `Document title: ${document.title}`,
    `Prompt title: ${prompt.title}`,
    "",
    "Review exactly one block. Add zero, one, or two comments only if they matter.",
    "Use only the current block_id.",
    ...(note
      ? [
          "",
          "Additional reviewer note for this block:",
          note,
        ]
      : []),
    "",
    formatBlock(block),
  ].join("\n");
};

const createSession = (document, prompt, mode) => {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    documentPath: document.path,
    documentTitle: document.title,
    promptPath: prompt.path,
    promptTitle: prompt.title,
    mode,
    summary: "",
    comments: [],
    status: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const buildFallbackSummary = (session, reviewedBlocksCount) => {
  if (session.comments.length === 0) {
    return `No actionable comments were added across ${reviewedBlocksCount} reviewable blocks.`;
  }

  const touchedBlocks = new Set(session.comments.map((comment) => comment.blockId)).size;
  return `Added ${session.comments.length} comments across ${touchedBlocks} blocks in paragraph-by-paragraph mode.`;
};

const noop = () => {};

const emitCommentAddedEvent = (session, onEvent) => (comment) => {
  onEvent({
    type: "comment_added",
    reviewId: session.id,
    totalComments: session.comments.length,
    comment,
  });
};

const truncate = (value, maxLength = 180) => {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
};

const countBy = (comments, values, selectValue) => Object.fromEntries(
  values.map((value) => [
    value,
    comments.filter((comment) => selectValue(comment) === value).length,
  ]),
);

const sortForSummary = (comments) => {
  const severityRank = { high: 0, medium: 1, low: 2 };
  const statusRank = { open: 0, accepted: 1, resolved: 2, rejected: 3, stale: 4 };

  return [...comments].sort((left, right) => {
    const severityDiff = (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9);
    if (severityDiff) return severityDiff;

    const statusDiff = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
    if (statusDiff) return statusDiff;

    return new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime();
  });
};

const buildSummaryInput = ({
  document,
  prompt,
  review,
  reviewedBlocksCount,
  previousSummary = "",
}) => {
  const comments = sortForSummary(review.comments);
  const sampledComments = comments.slice(0, SUMMARY_COMMENT_LIMIT);
  const touchedBlocks = new Set(comments.map((comment) => comment.blockId)).size;
  const statusCounts = countBy(comments, ["open", "accepted", "resolved", "rejected", "stale"], (comment) => comment.status);
  const severityCounts = countBy(comments, ["high", "medium", "low"], (comment) => comment.severity);
  const kindCounts = countBy(comments, ["comment", "suggestion"], (comment) => comment.kind);

  return [
    "Completed markdown review context:",
    `Document title: ${document.title}`,
    `Prompt title: ${prompt.title}`,
    `Prompt description: ${prompt.description || "n/a"}`,
    `Review mode: ${review.mode}`,
    `Reviewable blocks: ${reviewedBlocksCount}`,
    `Touched blocks: ${touchedBlocks}`,
    `Total comments: ${comments.length}`,
    `Status counts: ${JSON.stringify(statusCounts)}`,
    `Severity counts: ${JSON.stringify(severityCounts)}`,
    `Kind counts: ${JSON.stringify(kindCounts)}`,
    ...(previousSummary?.trim()
      ? [
          "",
          "Existing summary draft:",
          previousSummary.trim(),
        ]
      : []),
    "",
    "Most important comments:",
    ...(sampledComments.length > 0
      ? sampledComments.map((comment, index) => [
          `${index + 1}. [${comment.status}] [${comment.severity}] [${comment.kind}] ${truncate(comment.title, 80)}`,
          `   Note: ${truncate(comment.body, 180)}`,
          `   Quote: "${truncate(comment.quote, 120)}"`,
          ...(comment.suggestion
            ? [`   Suggestion: "${truncate(comment.suggestion, 120)}"`]
            : []),
        ].join("\n"))
      : ["None."]),
  ].join("\n");
};

const generateReviewSummary = async ({
  document,
  prompt,
  agent,
  review,
  reviewedBlocksCount,
  previousSummary = "",
}) => {
  const fallback = previousSummary?.trim() || buildFallbackSummary(review, reviewedBlocksCount);

  try {
    const response = await complete({
      model: agent.model,
      instructions: [
        "You generate concise, insightful summaries for a document review UI.",
        "Write plain text only.",
        "Write 1-2 short sentences.",
        "Be specific about the dominant themes and strongest concern, or explicitly say the pass came back clean.",
        "Do not use bullets, markdown, labels, or quotation marks unless needed.",
        "Do not mention block ids, tool names, or implementation details.",
        "Avoid filler like 'The review found' unless it improves clarity.",
      ].join("\n"),
      input: buildSummaryInput({
        document,
        prompt,
        review,
        reviewedBlocksCount,
        previousSummary,
      }),
    });

    const summary = response.text.trim();
    return summary || fallback;
  } catch {
    return fallback;
  }
};

const reviewSingleBlock = async ({
  session,
  document,
  prompt,
  agent,
  block,
  customMessage = "",
  onCommentAdded = noop,
}) => {
  const instructions = buildInstructions(agent, prompt);
  const blockMap = new Map(document.blocks.map((entry) => [entry.id, entry]));
  const tools = createReviewTools({
    session,
    blockMap,
    allowedBlockIds: new Set([block.id]),
    onCommentAdded,
  });

  await runAgent({
    input: buildParagraphInput(document, prompt, block, customMessage),
    instructions,
    model: agent.model,
    tools,
  });
};

const staleOpenCommentsForBlock = (review, blockId) => {
  const timestamp = new Date().toISOString();

  for (const comment of review.comments) {
    if (comment.blockId !== blockId || comment.status !== "open") continue;
    comment.status = "stale";
    comment.staleAt = timestamp;
  }
};

export const runReview = async ({ documentPath, promptPath, mode, onEvent = noop }) => {
  const [document, prompt, agent] = await Promise.all([
    loadDocument(documentPath),
    loadPrompt(promptPath),
    loadAgent("reviewer"),
  ]);

  const supportedModes = Array.isArray(prompt.frontmatter.modes) && prompt.frontmatter.modes.length > 0
    ? prompt.frontmatter.modes
    : ["paragraph", "at_once"];

  if (!supportedModes.includes(mode)) {
    throw new Error(`Prompt "${prompt.title}" does not support mode "${mode}".`);
  }

  const session = createSession(document, prompt, mode);
  const reviewableBlocks = document.blocks.filter((block) => (
    block.reviewable && REVIEWABLE_TYPES.has(block.type)
  ));

  onEvent({
    type: "started",
    reviewId: session.id,
    totalBlocks: reviewableBlocks.length,
    mode,
    document,
    review: session,
  });

  if (reviewableBlocks.length === 0) {
    session.status = "complete";
    session.summary = "This document does not contain reviewable text blocks.";
    await saveReview(session);

    return { document, review: session };
  }

  const instructions = buildInstructions(agent, prompt);
  const blockMap = new Map(document.blocks.map((block) => [block.id, block]));

  if (mode === "paragraph") {
    let completed = 0;

    const reviewBlock = async (block, i) => {
      onEvent({
        type: "block_start",
        blockIndex: i,
        totalBlocks: reviewableBlocks.length,
        blockId: block.id,
        blockType: block.type,
        blockPreview: block.text.slice(0, 80),
      });

      await reviewSingleBlock({
        session,
        document,
        prompt,
        agent,
        block,
        onCommentAdded: emitCommentAddedEvent(session, onEvent),
      });

      completed += 1;

      onEvent({
        type: "block_done",
        blockIndex: i,
        totalBlocks: reviewableBlocks.length,
        blockId: block.id,
        commentsAdded: session.comments.filter((c) => c.blockId === block.id).length,
        totalComments: session.comments.length,
        completedBlocks: completed,
      });
    };

    const queue = reviewableBlocks.map((block, i) => ({ block, i }));
    const workers = Array.from({ length: Math.min(PARAGRAPH_REVIEW_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const { block, i } = queue.shift();
        await reviewBlock(block, i);
      }
    });

    await Promise.all(workers);

    onEvent({ type: "summary_start" });
    session.summary = await generateReviewSummary({
      document,
      prompt,
      agent,
      review: session,
      reviewedBlocksCount: reviewableBlocks.length,
    });
  } else {
    onEvent({ type: "block_start", blockIndex: 0, totalBlocks: 1, blockId: "all", blockType: "document" });

    const tools = createReviewTools({
      session,
      blockMap,
      allowedBlockIds: new Set(reviewableBlocks.map((block) => block.id)),
      onCommentAdded: emitCommentAddedEvent(session, onEvent),
    });

    const result = await runAgent({
      input: buildAtOnceInput(document, prompt),
      instructions,
      model: agent.model,
      tools,
    });

    if (!session.summary) {
      session.summary = result.text.trim() || "Review completed.";
    }

    onEvent({ type: "summary_start" });
    session.summary = await generateReviewSummary({
      document,
      prompt,
      agent,
      review: session,
      reviewedBlocksCount: reviewableBlocks.length,
      previousSummary: session.summary,
    });

    onEvent({ type: "block_done", blockIndex: 0, totalBlocks: 1, blockId: "all", totalComments: session.comments.length });
  }

  session.status = "complete";
  session.updatedAt = new Date().toISOString();
  await saveReview(session);

  return { document, review: session };
};

export const rejectReviewComment = async ({ reviewId, commentId }) => {
  const review = await loadReview(reviewId);
  const comment = review.comments.find((entry) => entry.id === commentId);

  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (comment.status !== "open") throw new Error("Only open comments can be rejected.");

  comment.status = "rejected";
  comment.rejectedAt = new Date().toISOString();
  review.updatedAt = new Date().toISOString();

  await saveReview(review);
  return { document: await loadDocument(review.documentPath), review };
};

export const resolveReviewComment = async ({ reviewId, commentId }) => {
  const review = await loadReview(reviewId);
  const comment = review.comments.find((entry) => entry.id === commentId);

  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (comment.status !== "open") throw new Error("Only open comments can be resolved.");

  comment.status = "resolved";
  comment.resolvedAt = new Date().toISOString();
  review.updatedAt = new Date().toISOString();

  await saveReview(review);
  return { document: await loadDocument(review.documentPath), review };
};

export const convertToSuggestion = async ({ reviewId, commentId, suggestion }) => {
  const review = await loadReview(reviewId);
  const comment = review.comments.find((entry) => entry.id === commentId);

  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (comment.status !== "open") throw new Error("Only open comments can be converted.");
  if (!suggestion?.trim()) throw new Error("Suggestion text is required.");

  comment.kind = "suggestion";
  comment.suggestion = suggestion.trim();
  review.updatedAt = new Date().toISOString();

  await saveReview(review);
  return { document: await loadDocument(review.documentPath), review };
};

export const acceptReviewComment = async ({ reviewId, commentId }) => {
  const review = await loadReview(reviewId);
  const comment = review.comments.find((entry) => entry.id === commentId);

  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (comment.status !== "open") throw new Error("Only open comments can be accepted.");
  if (comment.kind !== "suggestion" || !comment.suggestion) throw new Error("Only suggestion comments can be accepted.");

  const document = await loadDocument(review.documentPath);
  const block = document.blocks.find((entry) => entry.id === comment.blockId);
  if (!block) throw new Error(`Block not found: ${comment.blockId}`);

  const originalText = block.text;
  const targetRange = resolveCommentRange(originalText, comment);
  if (targetRange.error) throw new Error(targetRange.error);

  const replacement = comment.suggestion;
  const delta = replacement.length - (targetRange.end - targetRange.start);

  block.text = [
    originalText.slice(0, targetRange.start),
    replacement,
    originalText.slice(targetRange.end),
  ].join("");

  for (const sibling of review.comments) {
    if (sibling.blockId !== comment.blockId || sibling.status !== "open") continue;

    const siblingRange = resolveCommentRange(originalText, sibling);

    if (siblingRange.error) {
      sibling.status = "stale";
      sibling.staleAt = new Date().toISOString();
      continue;
    }

    const isTarget = sibling.id === comment.id;
    const isOverlap = Math.max(siblingRange.start, targetRange.start) < Math.min(siblingRange.end, targetRange.end);

    if (isTarget) {
      sibling.status = "accepted";
      sibling.acceptedAt = new Date().toISOString();
      sibling.originalQuote = comment.quote;
      sibling.originalBlockText = originalText;
      sibling.start = targetRange.start;
      sibling.end = targetRange.start + replacement.length;
      sibling.quote = replacement;
      continue;
    }

    if (isOverlap) {
      sibling.status = "stale";
      sibling.staleAt = new Date().toISOString();
      continue;
    }

    if (siblingRange.start >= targetRange.end) {
      sibling.start = siblingRange.start + delta;
      sibling.end = siblingRange.end + delta;
    }
  }

  review.updatedAt = new Date().toISOString();
  await saveDocument(document);
  await saveReview(review);

  return { document: await loadDocument(review.documentPath), review };
};

export const revertReviewComment = async ({ reviewId, commentId }) => {
  const review = await loadReview(reviewId);
  const comment = review.comments.find((entry) => entry.id === commentId);

  if (!comment) throw new Error(`Comment not found: ${commentId}`);
  if (comment.status !== "accepted") throw new Error("Only accepted comments can be reverted.");
  if (!comment.originalBlockText) throw new Error("No revert data stored for this comment.");

  const document = await loadDocument(review.documentPath);
  const block = document.blocks.find((entry) => entry.id === comment.blockId);
  if (!block) throw new Error(`Block not found: ${comment.blockId}`);

  block.text = comment.originalBlockText;

  comment.status = "open";
  comment.quote = comment.originalQuote;
  delete comment.acceptedAt;
  delete comment.originalQuote;
  delete comment.originalBlockText;

  review.updatedAt = new Date().toISOString();
  await saveDocument(document);
  await saveReview(review);

  return { document: await loadDocument(review.documentPath), review };
};

export const batchAcceptComments = async ({ reviewId }) => {
  const review = await loadReview(reviewId);
  const openSuggestions = review.comments
    .filter((c) => c.status === "open" && c.kind === "suggestion" && c.suggestion)
    .sort((a, b) => {
      if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId);
      return b.start - a.start;
    });

  if (openSuggestions.length === 0) {
    return { document: await loadDocument(review.documentPath), review };
  }

  let document = await loadDocument(review.documentPath);

  const byBlock = new Map();
  for (const c of openSuggestions) {
    if (!byBlock.has(c.blockId)) byBlock.set(c.blockId, []);
    byBlock.get(c.blockId).push(c);
  }

  for (const [blockId, comments] of byBlock) {
    const block = document.blocks.find((b) => b.id === blockId);
    if (!block) continue;

    const sorted = [...comments].sort((a, b) => b.start - a.start);

    for (const comment of sorted) {
      const range = resolveCommentRange(block.text, comment);
      if (range.error) {
        comment.status = "stale";
        comment.staleAt = new Date().toISOString();
        continue;
      }

      comment.originalQuote = comment.quote;
      comment.originalBlockText = block.text;

      block.text = [
        block.text.slice(0, range.start),
        comment.suggestion,
        block.text.slice(range.end),
      ].join("");

      comment.status = "accepted";
      comment.acceptedAt = new Date().toISOString();
      comment.quote = comment.suggestion;
    }
  }

  review.updatedAt = new Date().toISOString();
  await saveDocument(document);
  await saveReview(review);

  return { document: await loadDocument(review.documentPath), review };
};

export const batchRejectComments = async ({ reviewId }) => {
  const review = await loadReview(reviewId);
  let changed = false;

  for (const comment of review.comments) {
    if (comment.status !== "open") continue;
    comment.status = "rejected";
    comment.rejectedAt = new Date().toISOString();
    changed = true;
  }

  if (changed) {
    review.updatedAt = new Date().toISOString();
    await saveReview(review);
  }

  return { document: await loadDocument(review.documentPath), review };
};

export const rerunReviewBlock = async ({ reviewId, blockId, message = "" }) => {
  const review = await loadReview(reviewId);
  const [document, prompt, agent] = await Promise.all([
    loadDocument(review.documentPath),
    loadPrompt(review.promptPath),
    loadAgent("reviewer"),
  ]);

  const block = document.blocks.find((entry) => entry.id === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);
  if (!block.reviewable || !REVIEWABLE_TYPES.has(block.type)) {
    throw new Error("This block cannot be reviewed individually.");
  }

  const existingCommentIds = new Set(review.comments.map((comment) => comment.id));
  staleOpenCommentsForBlock(review, blockId);

  await reviewSingleBlock({
    session: review,
    document,
    prompt,
    agent,
    block,
    customMessage: message,
  });

  review.summary = await generateReviewSummary({
    document,
    prompt,
    agent,
    review,
    reviewedBlocksCount: document.blocks.filter((entry) => entry.reviewable && REVIEWABLE_TYPES.has(entry.type)).length,
    previousSummary: review.summary,
  });
  review.updatedAt = new Date().toISOString();
  await saveReview(review);

  const createdCommentIds = review.comments
    .filter((comment) => comment.blockId === blockId && !existingCommentIds.has(comment.id))
    .map((comment) => comment.id);

  return {
    document: await loadDocument(review.documentPath),
    review,
    blockId,
    createdCommentIds,
  };
};

export const getDocumentMarkdown = async (documentPath) => {
  const document = await loadDocument(documentPath);
  const matter = (await import("gray-matter")).default;
  return matter.stringify(serializeMarkdownBlocks(document.blocks), document.frontmatter ?? {});
};

export const updateBlock = async ({ documentPath, blockId, text }) => {
  const document = await loadDocument(documentPath);
  const block = document.blocks.find((b) => b.id === blockId);

  if (!block) throw new Error(`Block not found: ${blockId}`);

  block.text = text;
  await saveDocument(document);

  return { document: await loadDocument(documentPath) };
};
