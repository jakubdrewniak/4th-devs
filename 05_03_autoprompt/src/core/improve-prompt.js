import { complete } from "../llm/complete.js";
import { formatEvaluationPolicy } from "./format-evaluation-policy.js";
import { IMPROVER_SYSTEM } from "../prompts/improver-system.js";

const formatBreakdown = (breakdown) => {
  if (!breakdown) return "";

  const lines = [];
  for (const [section, result] of Object.entries(breakdown)) {
    lines.push(`  ${section}: ${result.score.toFixed(2)}`);
    for (const issue of result.issues) {
      lines.push(`    ${issue}`);
    }
  }

  return lines.join("\n");
};

export const detectStuck = (history) => {
  if (history.length < 3) return "";

  const recent = history.slice(-3);
  const allDiscarded = recent.every((entry) => entry.status === "discard");
  const sameOperation = recent.every((entry) => entry.operation === recent[0].operation);

  if (allDiscarded && sameOperation) {
    return [
      "## STRATEGY CHANGE REQUIRED",
      "",
      `The last ${recent.length} attempts were all ${recent[0].operation} and all discarded.`,
      `Forbidden this iteration: ${recent[0].operation}`,
      "",
      "Strong alternatives:",
      "- REMOVE: free attention by deleting a redundant rule.",
      "- MERGE: combine overlapping rules into one sharper rule.",
      "- REORDER: move the most important rule to the top or bottom.",
      "",
    ].join("\n");
  }

  if (allDiscarded) {
    return [
      "## Caution: 3 consecutive discards",
      "",
      `Recent operations: ${recent.map((entry) => entry.operation).join(", ")}`,
      "Consider a different error type or a simplification move like REMOVE or MERGE.",
      "",
    ].join("\n");
  }

  return "";
};

export const parseImproverResponse = (raw) => {
  const separator = "---PROMPT---";
  const separatorIndex = raw.indexOf(separator);

  if (separatorIndex === -1) {
    return {
      reasoning: "(no reasoning provided)",
      operation: "UNKNOWN",
      prompt: raw.trim(),
    };
  }

  const meta = raw.slice(0, separatorIndex);
  const prompt = raw.slice(separatorIndex + separator.length).trim();
  const reasoningMatch = meta.match(/REASONING:\s*([\s\S]*?)(?=\nOPERATION:|\n---)/i);
  const operationMatch = meta.match(/OPERATION:\s*(\w+)/i);

  return {
    reasoning: reasoningMatch?.[1]?.trim() || "(no reasoning)",
    operation: operationMatch?.[1]?.trim().toUpperCase() || "UNKNOWN",
    prompt,
  };
};

export const buildImproverMessage = ({
  prompt,
  evalResult,
  testCases,
  history,
  extractionSchema,
  evaluation,
  candidateHint,
}) => {
  const caseSections = evalResult.results.map((result) => {
    const testCase = testCases.find((entry) => entry.id === result.id);
    const inputPreview = testCase ? testCase.input.slice(0, 800) : "(unavailable)";

    if (result.error) {
      return [
        `### Case ${result.id} - score: ${result.score} - ERROR`,
        "",
        "**Input (truncated):**",
        inputPreview,
        "",
        `**Error:** ${result.error}`,
      ].join("\n");
    }

    return [
      `### Case ${result.id} - score: ${result.score}`,
      `\n**Score breakdown:**\n\`\`\`\n${formatBreakdown(result.breakdown)}\n\`\`\``,
      `\n**Input (truncated):**\n${inputPreview}`,
      `\n**Actual output:**\n\`\`\`json\n${JSON.stringify(result.actual, null, 2)}\n\`\`\``,
      `\n**Expected output:**\n\`\`\`json\n${JSON.stringify(result.expected, null, 2)}\n\`\`\``,
    ].join("\n");
  }).join("\n\n");

  const historySection = history.length
    ? [
      "## Previous attempts (do NOT repeat failed approaches)",
      "",
      ...history.map((entry) => [
        `- **${entry.status}** [${entry.operation || "?"}] (score: ${entry.score}) - ${entry.reasoning || entry.diff}`,
        entry.candidateLabel ? `  candidate: ${entry.candidateLabel}` : null,
        entry.sectionSummary ? `  sections: ${entry.sectionSummary}` : null,
        entry.sectionDeltaSummary ? `  deltas: ${entry.sectionDeltaSummary}` : null,
      ].filter(Boolean).join("\n")),
      "",
    ].join("\n")
    : "";

  const stuckWarning = detectStuck(history);
  const candidateStrategySection = candidateHint
    ? [
      "## Candidate strategy for this attempt",
      "",
      candidateHint,
      "",
    ].join("\n")
    : "";

  return [
    "## Output schema (fixed, enforced by project config - the prompt cannot change this)",
    "",
    `\`\`\`json\n${JSON.stringify(extractionSchema.schema, null, 2)}\n\`\`\``,
    "",
    "## Evaluation policy (fixed, enforced by project config)",
    "",
    "```text",
    formatEvaluationPolicy(evaluation),
    "```",
    "",
    "## Current prompt",
    "",
    prompt,
    "",
    candidateStrategySection,
    historySection,
    stuckWarning,
    `## Eval results (avg: ${evalResult.avg})`,
    "",
    caseSections,
    "",
    "Audit schema coverage and evaluation coverage first, then diagnose the dominant error type, then return the full improved prompt.",
  ].join("\n");
};

export const suggestPromptImprovement = async ({
  prompt,
  evalResult,
  testCases,
  history,
  extractionSchema,
  evaluation,
  models,
  candidateHint,
  temperature = null,
}) => {
  const raw = await complete(
    IMPROVER_SYSTEM,
    buildImproverMessage({
      prompt,
      evalResult,
      testCases,
      history,
      extractionSchema,
      evaluation,
      candidateHint,
    }),
    {
      model: models.improver.model,
      reasoning: models.improver.reasoning,
      temperature,
      stage: `improver/${candidateHint ? candidateHint.split(":")[0].toLowerCase().replace(/\s+/g, "_") : "default"}`,
    },
  );

  return parseImproverResponse(raw);
};
