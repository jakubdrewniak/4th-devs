import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNS_DIR } from "../config/defaults.js";
import { collectTraces } from "../llm/trace.js";

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const writeDiffLog = (diffsDir, iteration) => {
  const header = `# Iteration ${iteration.iteration} - ${iteration.status} - score: ${iteration.score.toFixed(4)}\n`;
  const candidateLines = iteration.candidates?.length
    ? [
      "Candidates:",
      ...iteration.candidates.map((candidate) => `- ${candidate.candidateLabel}: ${candidate.score.toFixed(4)} (${candidate.status}) ${candidate.sectionDeltaSummary || ""}`.trim()),
      "",
    ].join("\n")
    : "";
  const meta = [
    `Candidate: ${iteration.candidateLabel ?? "n/a"}`,
    `Operation: ${iteration.operation}`,
    `Reasoning: ${iteration.reasoning}`,
    iteration.sectionSummary ? `Section scores: ${iteration.sectionSummary}` : null,
    iteration.sectionDeltaSummary ? `Section deltas: ${iteration.sectionDeltaSummary}` : null,
    "",
    candidateLines,
  ].filter(Boolean).join("\n");
  writeFileSync(
    resolve(diffsDir, `${String(iteration.iteration).padStart(3, "0")}_${iteration.status}.diff`),
    header + meta + "\n" + iteration.diff + "\n",
  );
};

export const writeOptimizeRun = ({ project, run }) => {
  const runDir = resolve(RUNS_DIR, project.name, timestamp());
  const diffsDir = resolve(runDir, "diffs");

  mkdirSync(diffsDir, { recursive: true });

  const lines = [
    "iteration\tscore\tstatus\tcandidate\toperation\tsection_changes\tdescription",
    `0\t${run.baseline.avg.toFixed(4)}\tbaseline\tbaseline\tbaseline\t-\tinitial prompt (+/-${run.baseline.spread.toFixed(4)})`,
    ...run.iterations.map((iteration) => [
      iteration.iteration,
      iteration.score.toFixed(4),
      iteration.status,
      iteration.candidateLabel ?? "n/a",
      iteration.operation,
      iteration.sectionDeltaSummary || "-",
      iteration.diffSummary,
    ].join("\t")),
  ];

  writeFileSync(resolve(runDir, "results.tsv"), `${lines.join("\n")}\n`);
  writeFileSync(
    resolve(runDir, "run.json"),
    `${JSON.stringify({
      project: project.name,
      models: run.models,
      evalRuns: run.evalRuns,
      maxIterations: run.maxIterations,
      baselineScore: run.baseline.avg,
      bestScore: run.bestScore,
    }, null, 2)}\n`,
  );
  writeFileSync(resolve(runDir, "prompt.initial.md"), project.initialPrompt);
  writeFileSync(resolve(runDir, "prompt.best.md"), run.bestPrompt);

  for (const iteration of run.iterations) {
    writeDiffLog(diffsDir, iteration);
  }

  const traces = collectTraces();
  if (traces.length > 0) {
    const tracesDir = resolve(runDir, "traces");
    mkdirSync(tracesDir, { recursive: true });

    const byStage = {};
    for (const trace of traces) {
      const stageKey = trace.stage.replace(/[/]/g, "__");
      (byStage[stageKey] ??= []).push(trace);
    }

    for (const [stageKey, stageTraces] of Object.entries(byStage)) {
      writeFileSync(
        resolve(tracesDir, `${stageKey}.json`),
        JSON.stringify(stageTraces, null, 2) + "\n",
      );
    }
  }

  return runDir;
};
