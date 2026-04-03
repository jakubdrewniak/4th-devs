import { randomUUID } from "node:crypto";

import { findQuoteRange } from "./markdown.js";

const noop = async () => {};

const overlaps = (left, right) => (
  Math.max(left.start, right.start) < Math.min(left.end, right.end)
);

const addCommentDefinition = {
  type: "function",
  name: "add_comment",
  description:
    "Add a review comment anchored to an exact quote inside one block. " +
    "Use kind=suggestion when the UI should be able to replace the quote with your proposed text.",
  parameters: {
    type: "object",
    properties: {
      block_id: {
        type: "string",
        description: "Block id from the review payload, for example b3.",
      },
      quote: {
        type: "string",
        description: "Exact text from the selected block. It must uniquely match once.",
      },
      kind: {
        type: "string",
        enum: ["comment", "suggestion"],
        description: "Use suggestion only when replacement text is appropriate.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How important the issue is.",
      },
      title: {
        type: "string",
        description: "Short label shown in the UI.",
      },
      comment: {
        type: "string",
        description: "Explain why the highlighted fragment should change.",
      },
      suggestion: {
        type: ["string", "null"],
        description:
          "Replacement text for the highlighted quote. Use null when kind is comment.",
      },
    },
    required: ["block_id", "quote", "kind", "severity", "title", "comment", "suggestion"],
    additionalProperties: false,
  },
  strict: true,
};

export const createReviewTools = ({
  session,
  blockMap,
  allowedBlockIds,
  onCommentAdded = noop,
}) => {
  const addComment = {
    definition: addCommentDefinition,
    handler: async ({
      block_id,
      quote,
      kind,
      severity,
      title,
      comment,
      suggestion,
    }) => {
      const normalizedSuggestion = typeof suggestion === "string"
        ? suggestion
        : "";

      const block = blockMap.get(block_id);

      if (!block) {
        return {
          status: "rejected",
          error: `Unknown block_id: ${block_id}`,
        };
      }

      if (!allowedBlockIds.has(block_id)) {
        return {
          status: "rejected",
          error: `Block ${block_id} is outside the current review scope.`,
        };
      }

      if (kind === "suggestion" && !normalizedSuggestion.trim()) {
        return {
          status: "rejected",
          error: "Suggestions require non-empty replacement text.",
        };
      }

      const range = findQuoteRange(block.text, quote);

      if (range.error) {
        return {
          status: "rejected",
          error: range.error,
        };
      }

      const existing = session.comments.find((entry) => (
        entry.blockId === block_id
        && entry.status === "open"
        && overlaps(entry, range)
      ));

      if (existing) {
        return {
          status: "rejected",
          error: `Quote overlaps with existing comment ${existing.id}.`,
        };
      }

      const entry = {
        id: randomUUID(),
        blockId: block_id,
        quote,
        start: range.start,
        end: range.end,
        kind,
        severity,
        title: title.trim(),
        body: comment.trim(),
        suggestion: kind === "suggestion" ? normalizedSuggestion.trim() : "",
        status: "open",
        createdAt: new Date().toISOString(),
      };

      session.comments.push(entry);
      session.updatedAt = new Date().toISOString();
      await onCommentAdded({ ...entry });

      return {
        status: "comment_added",
        comment_id: entry.id,
        block_id,
        start: entry.start,
        end: entry.end,
      };
    },
  };

  return [addComment];
};
