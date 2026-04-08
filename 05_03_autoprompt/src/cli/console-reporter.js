const dim = (value) => `\x1b[2m${value}\x1b[0m`;
const green = (value) => `\x1b[32m${value}\x1b[0m`;
const red = (value) => `\x1b[31m${value}\x1b[0m`;
const yellow = (value) => `\x1b[33m${value}\x1b[0m`;
const bold = (value) => `\x1b[1m${value}\x1b[0m`;
const cyan = (value) => `\x1b[36m${value}\x1b[0m`;

const formatModelProfile = (profile) => {
  const effort = profile.reasoning?.effort ?? "default";
  return `${profile.model} reasoning:${effort}`;
};

const bar = (value, max = 1, width = 30) => {
  const filled = Math.round((value / max) * width);
  return green("#".repeat(filled)) + dim(".".repeat(width - filled));
};

const printCaseResult = (result) => {
  const icon = result.score >= 0.8 ? green("OK") : result.score >= 0.5 ? yellow("~") : red("X");
  const sections = result.breakdown
    ? Object.entries(result.breakdown).map(([key, value]) => `${key[0]}:${value.score.toFixed(2)}`).join(" ")
    : "";

  console.log(dim(`    ${icon} case ${result.id}: ${result.score.toFixed(4)} ${sections}`));

  if (!result.breakdown) return;

  for (const [section, breakdown] of Object.entries(result.breakdown)) {
    for (const issue of breakdown.issues) {
      console.log(dim(`      - ${section}: ${issue}`));
    }
  }
};

export const createOptimizeReporter = (project) => ({
  onStart({ maxIterations, evalRuns, candidateCount }) {
    console.log(bold("\nautoprompt"));
    console.log(dim(`  project: ${project.name}`));
    console.log(dim(`  tests: ${project.testCases.length}`));
    console.log(dim(`  prompt: ${project.promptPath}`));
    console.log(dim(`  execution: ${formatModelProfile(project.models.execution)}`));
    console.log(dim(`  judge: ${formatModelProfile(project.models.judge)}`));
    console.log(dim(`  improver: ${formatModelProfile(project.models.improver)}`));
    console.log(dim(`  iterations: ${maxIterations}`));
    console.log(dim(`  eval runs: ${evalRuns}\n`));
    console.log(dim(`  candidates: ${candidateCount}\n`));
  },

  onBaseline({ baseline }) {
    console.log(dim("-".repeat(60)));
    console.log(bold("  baseline"));
    console.log(`  ${bar(baseline.avg)} ${bold(baseline.avg.toFixed(4))} ${dim(`+/-${baseline.spread.toFixed(4)}`)}`);
    for (const result of baseline.results) {
      printCaseResult(result);
    }
  },

  onIterationStart({ iterationNumber, maxIterations, history, candidateCount }) {
    console.log(dim(`\n${"-".repeat(60)}`));
    console.log(bold(`  iteration ${iterationNumber}/${maxIterations}`));
    if (history.length >= 3 && history.slice(-3).every((entry) => entry.status === "discard")) {
      console.log(yellow("  strategy change recommended"));
    } else {
      console.log(dim(`  generating ${candidateCount} candidates...`));
    }
  },

  onCandidateSuggestions({ suggestions }) {
    for (const suggestion of suggestions) {
      console.log(cyan(`  [${suggestion.candidateLabel}/${suggestion.operation}]`), dim(suggestion.reasoning.split("\n")[0]));
    }
    console.log(dim("  evaluating candidates..."));
  },

  onImproverError({ error }) {
    console.log(red(`  improver failed: ${error.message}`));
  },

  onIterationEvaluated({ iteration }) {
    if (iteration.candidates?.length) {
      const candidateLine = iteration.candidates
        .map((candidate) => `${candidate.candidateLabel}:${candidate.score.toFixed(4)}${candidate.status === "keep" ? "*" : ""}`)
        .join("  ");
      console.log(dim(`  candidates: ${candidateLine}`));
    }

    console.log(
      `  ${bar(iteration.score)} ${bold(iteration.score.toFixed(4))} ${
        iteration.delta >= 0 ? green(`+${iteration.delta.toFixed(4)}`) : red(iteration.delta.toFixed(4))
      } ${dim(`+/-${iteration.result.spread.toFixed(4)} floor:${iteration.noiseFloor.toFixed(4)}`)}`,
    );

    if (iteration.delta > 0 && iteration.status !== "keep") {
      console.log(yellow("  improvement within noise range - treating as no change"));
    }

    for (const result of iteration.result.results) {
      printCaseResult(result);
    }

    if (iteration.sectionDeltaSummary) {
      console.log(dim(`  section deltas: ${iteration.sectionDeltaSummary}`));
    }

    console.log(dim("  diff:"));
    const lines = iteration.diff.split("\n");
    for (const line of lines.slice(0, 12)) {
      const color = line.startsWith("+") ? green : line.startsWith("-") ? red : dim;
      console.log(`    ${color(line)}`);
    }
    if (lines.length > 12) {
      console.log(dim(`    ... ${lines.length - 12} more lines`));
    }

    console.log(iteration.status === "keep" ? green("  -> keep") : yellow("  -> discard"));
  },

  onComplete(run) {
    console.log(dim(`\n${"=".repeat(60)}`));
    console.log(bold("  done\n"));
    console.log(`  baseline: ${run.baseline.avg.toFixed(4)}`);
    console.log(
      `  final:    ${bold(run.bestScore.toFixed(4))} ${
        run.bestScore > run.baseline.avg
          ? green(`+${(run.bestScore - run.baseline.avg).toFixed(4)}`)
          : dim("no change")
      }`,
    );
  },
});

export const printVerifyResult = ({ project, promptPath, result }) => {
  console.log(bold("\nautoprompt - verify"));
  console.log(dim(`  project: ${project.name}`));
  console.log(dim(`  tests: ${project.testCases.length}`));
  console.log(dim(`  execution: ${formatModelProfile(project.models.execution)}`));
  console.log(dim(`  judge: ${formatModelProfile(project.models.judge)}`));
  console.log(dim(`  prompt: ${promptPath}\n`));
  console.log(dim("-".repeat(60)));
  console.log(`  ${bar(result.avg)} ${bold(result.avg.toFixed(4))}\n`);

  for (const caseResult of result.results) {
    printCaseResult(caseResult);
  }

  console.log(dim(`\n${"=".repeat(60)}`));
  console.log(bold(`  score: ${result.avg.toFixed(4)}\n`));
};
