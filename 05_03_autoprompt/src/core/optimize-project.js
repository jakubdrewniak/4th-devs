import { CANDIDATE_COUNT, EVAL_RUNS, MAX_ITERATIONS } from "../config/defaults.js";
import { runEvaluation } from "./run-evaluation.js";
import { suggestPromptImprovement } from "./improve-prompt.js";
import { computeDiff, summarizeDiff } from "./prompt-diff.js";

const CANDIDATE_STRATEGIES = [
  {
    label: "balanced",
    temperature: null,
    hint: "Balanced attempt: choose the highest-impact single change without any special bias.",
  },
  {
    label: "coverage",
    temperature: null,
    hint: "Coverage attempt: prefer ADD or REWORD when a scored schema/evaluation concern lacks a clear rule.",
  },
  {
    label: "simplify",
    temperature: null,
    hint: "Simplification attempt: prefer REMOVE or MERGE when rules overlap or can be compressed without losing coverage.",
  },
  {
    label: "boundary",
    temperature: null,
    hint: "Boundary attempt: prefer a rule that sharpens what counts as a task, decision, person, or project.",
  },
  {
    label: "salience",
    temperature: null,
    hint: "Salience attempt: prefer REORDER or REWORD to make the most important rule easier for the model to follow.",
  },
];

const buildCandidateStrategies = (count) => Array.from({ length: count }, (_, index) => {
  const base = CANDIDATE_STRATEGIES[index % CANDIDATE_STRATEGIES.length];
  if (index < CANDIDATE_STRATEGIES.length) return base;
  return {
    ...base,
    label: `${base.label}-${index + 1}`,
    temperature: null,
  };
});

const averageSectionScores = (evalResult) => {
  const totals = {};
  const counts = {};

  for (const result of evalResult.results) {
    if (!result.breakdown) continue;

    for (const [section, value] of Object.entries(result.breakdown)) {
      totals[section] = (totals[section] ?? 0) + value.score;
      counts[section] = (counts[section] ?? 0) + 1;
    }
  }

  return Object.fromEntries(
    Object.keys(totals).map((section) => [
      section,
      Math.round((totals[section] / counts[section]) * 10000) / 10000,
    ]),
  );
};

const computeSectionDeltas = (sectionScores, referenceSectionScores) => {
  const keys = new Set([
    ...Object.keys(sectionScores ?? {}),
    ...Object.keys(referenceSectionScores ?? {}),
  ]);

  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      Math.round(((sectionScores?.[key] ?? 0) - (referenceSectionScores?.[key] ?? 0)) * 10000) / 10000,
    ]),
  );
};

const formatSectionSummary = (sectionScores) => Object.entries(sectionScores)
  .map(([section, score]) => `${section}:${score.toFixed(2)}`)
  .join(" ");

const formatSectionDeltaSummary = (sectionDeltas) => Object.entries(sectionDeltas)
  .filter(([, delta]) => Math.abs(delta) > 0.0001)
  .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
  .map(([section, delta]) => `${section}:${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`)
  .join(" ");

const toHistoryEntry = (iteration) => ({
  status: iteration.status,
  score: iteration.score.toFixed(4),
  operation: iteration.operation,
  reasoning: iteration.reasoning.replace(/\n/g, " ").slice(0, 200),
  candidateLabel: iteration.candidateLabel,
  sectionSummary: iteration.sectionSummary,
  sectionDeltaSummary: iteration.sectionDeltaSummary,
  diff: iteration.diff.split("\n").slice(0, 3).join(" | "),
});

const compareCandidateIterations = (left, right) => {
  if (left.status === "keep" && right.status !== "keep") return -1;
  if (right.status === "keep" && left.status !== "keep") return 1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.delta !== left.delta) return right.delta - left.delta;
  return left.prompt.length - right.prompt.length;
};

export const optimizeProject = async ({
  project,
  maxIterations = MAX_ITERATIONS,
  evalRuns = EVAL_RUNS,
  reporter,
}) => {
  const candidateCount = project.optimization?.candidates ?? CANDIDATE_COUNT;
  reporter?.onStart?.({ project, maxIterations, evalRuns, candidateCount });

  let currentPrompt = project.initialPrompt;
  let bestPrompt = currentPrompt;
  let bestScore = 0;

  const baseline = await runEvaluation({
    prompt: currentPrompt,
    testCases: project.testCases,
    extractionSchema: project.extractionSchema,
    evaluation: project.evaluation,
    models: project.models,
    runs: evalRuns,
  });

  bestScore = baseline.avg;
  reporter?.onBaseline?.({ baseline });

  let lastEval = baseline;
  let bestSectionScores = averageSectionScores(baseline);
  const iterations = [];

  for (let iterationNumber = 1; iterationNumber <= maxIterations; iterationNumber += 1) {
    const history = iterations.slice(-5).map(toHistoryEntry);
    const candidateStrategies = buildCandidateStrategies(candidateCount);
    reporter?.onIterationStart?.({
      iterationNumber,
      maxIterations,
      history,
      candidateCount,
    });

    let suggestions;
    try {
      const suggestionResults = await Promise.allSettled(candidateStrategies.map(async (strategy) => ({
        ...(await suggestPromptImprovement({
          prompt: currentPrompt,
          evalResult: lastEval,
          testCases: project.testCases,
          history,
          extractionSchema: project.extractionSchema,
          evaluation: project.evaluation,
          models: project.models,
          candidateHint: strategy.hint,
          temperature: strategy.temperature,
        })),
        candidateLabel: strategy.label,
        candidateHint: strategy.hint,
      })));

      suggestions = suggestionResults
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      if (suggestions.length === 0) {
        throw new Error("all candidate generations failed");
      }
    } catch (error) {
      const crashIteration = {
        iteration: iterationNumber,
        score: 0,
        status: "crash",
        operation: "ERROR",
        reasoning: error.message,
        candidateLabel: "improver",
        sectionSummary: "",
        sectionDeltaSummary: "",
        diff: "(improver failed before generating a prompt)",
        diffSummary: "(none)",
        result: null,
        candidates: [],
      };
      iterations.push(crashIteration);
      reporter?.onImproverError?.({ iteration: crashIteration, error });
      continue;
    }

    reporter?.onCandidateSuggestions?.({
      iterationNumber,
      suggestions,
    });

    const candidateResults = await Promise.allSettled(suggestions.map(async (suggestion) => {
      const candidateResult = await runEvaluation({
        prompt: suggestion.prompt,
        testCases: project.testCases,
        extractionSchema: project.extractionSchema,
        evaluation: project.evaluation,
        models: project.models,
        runs: evalRuns,
      });

      const delta = candidateResult.avg - bestScore;
      const noiseFloor = Math.max(candidateResult.spread, lastEval.spread) / 2;
      const improved = delta > noiseFloor;
      const diff = computeDiff(currentPrompt, suggestion.prompt);
      const sectionScores = averageSectionScores(candidateResult);
      const sectionDeltas = computeSectionDeltas(sectionScores, bestSectionScores);

      return {
        iteration: iterationNumber,
        score: candidateResult.avg,
        status: improved ? "keep" : "discard",
        operation: suggestion.operation,
        reasoning: suggestion.reasoning,
        candidateLabel: suggestion.candidateLabel,
        prompt: suggestion.prompt,
        diff,
        diffSummary: summarizeDiff(currentPrompt, suggestion.prompt),
        result: candidateResult,
        delta,
        noiseFloor,
        sectionScores,
        sectionDeltas,
        sectionSummary: formatSectionSummary(sectionScores),
        sectionDeltaSummary: formatSectionDeltaSummary(sectionDeltas),
      };
    }));

    const candidateIterations = candidateResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (candidateIterations.length === 0) {
      const crashIteration = {
        iteration: iterationNumber,
        score: 0,
        status: "crash",
        operation: "ERROR",
        reasoning: "all candidate evaluations failed",
        candidateLabel: "evaluation",
        sectionSummary: "",
        sectionDeltaSummary: "",
        diff: "(evaluation failed before scoring any candidate)",
        diffSummary: "(none)",
        result: null,
        candidates: [],
      };
      iterations.push(crashIteration);
      reporter?.onImproverError?.({ iteration: crashIteration, error: new Error(crashIteration.reasoning) });
      continue;
    }

    const bestCandidate = [...candidateIterations].sort(compareCandidateIterations)[0];
    const iteration = {
      ...bestCandidate,
      candidates: candidateIterations.map((candidate) => ({
        candidateLabel: candidate.candidateLabel,
        operation: candidate.operation,
        status: candidate.status,
        score: candidate.score,
        delta: candidate.delta,
        noiseFloor: candidate.noiseFloor,
        diffSummary: candidate.diffSummary,
        sectionSummary: candidate.sectionSummary,
        sectionDeltaSummary: candidate.sectionDeltaSummary,
      })),
    };

    iterations.push(iteration);
    reporter?.onIterationEvaluated?.({ iteration });

    if (iteration.status === "keep") {
      currentPrompt = iteration.prompt;
      bestPrompt = iteration.prompt;
      bestScore = iteration.score;
      lastEval = iteration.result;
      bestSectionScores = iteration.sectionScores;
    }
  }

  const run = {
    projectName: project.name,
    baseline,
    bestPrompt,
    bestScore,
    models: project.models,
    iterations,
    evalRuns,
    maxIterations,
  };

  reporter?.onComplete?.(run);
  return run;
};
