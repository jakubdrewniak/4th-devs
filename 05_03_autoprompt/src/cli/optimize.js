import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EVAL_RUNS, MAX_ITERATIONS } from "../config/defaults.js";
import { optimizeProject } from "../core/optimize-project.js";
import { createOptimizeReporter } from "./console-reporter.js";
import { loadProject } from "../project/load-project.js";
import { writeOptimizeRun } from "../run-artifacts/write-optimize-run.js";

const usage = () => {
  console.log("Usage: node src/cli/optimize.js <project-dir> [--iterations N] [--runs N]");
};

const parseArgs = (argv) => {
  let projectDir = "";
  let iterations = MAX_ITERATIONS;
  let runs = EVAL_RUNS;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--iterations") {
      iterations = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--runs") {
      runs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (projectDir) {
      throw new Error("Only one project directory may be provided");
    }
    projectDir = arg;
  }

  if (!projectDir) return { help: true };
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error("--iterations must be a positive integer");
  if (!Number.isInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");

  return { help: false, projectDir, iterations, runs };
};

export const runOptimizeCli = async (argv = process.argv) => {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return;
  }

  const project = await loadProject(resolve(args.projectDir));
  const run = await optimizeProject({
    project,
    maxIterations: args.iterations,
    evalRuns: args.runs,
    reporter: createOptimizeReporter(project),
  });

  const runDir = writeOptimizeRun({ project, run });
  console.log(`\n  run: ${runDir}`);
  console.log(`  best prompt: ${resolve(runDir, "prompt.best.md")}\n`);
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  runOptimizeCli().catch((error) => {
    console.error(`\nFatal: ${error.message}`);
    process.exit(1);
  });
}
