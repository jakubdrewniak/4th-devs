import { scoreBatch } from "./score-batch.js";
import { complete } from "../llm/complete.js";

const buildUserMessage = ({ input, context }) => {
  if (!context) return input;
  return `## Context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\n## Input\n\n${input}`;
};

export const runSingleEvaluation = async ({
  prompt,
  testCases,
  extractionSchema,
  evaluation,
  models,
}) => {
  const extractions = await Promise.all(testCases.map(async (testCase) => {
    try {
      const raw = await complete(prompt, buildUserMessage(testCase), {
        model: models.execution.model,
        reasoning: models.execution.reasoning,
        jsonSchema: extractionSchema,
        stage: `extraction/case_${testCase.id}`,
      });
      return {
        id: testCase.id,
        actual: JSON.parse(raw),
        expected: testCase.expected,
        error: null,
      };
    } catch (error) {
      return {
        id: testCase.id,
        actual: null,
        expected: testCase.expected,
        error: error.message,
      };
    }
  }));

  const succeeded = extractions.filter((extraction) => extraction.actual !== null);
  const failed = extractions.filter((extraction) => extraction.actual === null);
  const judged = succeeded.length ? await scoreBatch(succeeded, evaluation, models) : [];

  const results = [
    ...judged,
    ...failed.map((extraction) => ({
      id: extraction.id,
      score: 0,
      breakdown: null,
      actual: null,
      expected: extraction.expected,
      error: extraction.error,
    })),
  ].sort((left, right) => left.id.localeCompare(right.id));

  const average = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  return {
    avg: Math.round(average * 10000) / 10000,
    results,
  };
};

export const runEvaluation = async ({
  prompt,
  testCases,
  extractionSchema,
  evaluation,
  models,
  runs,
}) => {
  const allRuns = await Promise.all(
    Array.from({ length: runs }, () => runSingleEvaluation({
      prompt,
      testCases,
      extractionSchema,
      evaluation,
      models,
    })),
  );

  const avgScore = Math.round(
    allRuns.reduce((sum, run) => sum + run.avg, 0) / runs * 10000,
  ) / 10000;

  const sorted = [...allRuns].sort((left, right) => left.avg - right.avg);
  const median = sorted[Math.floor(sorted.length / 2)];
  const spread = sorted[sorted.length - 1].avg - sorted[0].avg;

  return {
    avg: avgScore,
    results: median.results,
    spread,
    runs: allRuns,
  };
};
