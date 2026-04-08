import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProject } from "../project/load-project.js";
import { printVerifyResult } from "./console-reporter.js";
import { runSingleEvaluation } from "../core/run-evaluation.js";

const usage = () => {
  console.log("Usage: node src/cli/verify.js <project-dir> [--prompt path/to/prompt.md]");
};

const parseArgs = (argv) => {
  let projectDir = "";
  let promptPath = "";

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--prompt") {
      promptPath = argv[index + 1] || "";
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
  return { help: false, projectDir, promptPath };
};

export const runVerifyCli = async (argv = process.argv) => {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return;
  }

  const project = await loadProject(resolve(args.projectDir));
  const promptPath = args.promptPath ? resolve(args.promptPath) : project.promptPath;
  const prompt = readFileSync(promptPath, "utf-8");
  const result = await runSingleEvaluation({
    prompt,
    testCases: project.verifyCases,
    extractionSchema: project.extractionSchema,
    evaluation: project.evaluation,
    models: project.models,
  });

  printVerifyResult({ project, promptPath, result });
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  runVerifyCli().catch((error) => {
    console.error(`\nFatal: ${error.message}`);
    process.exit(1);
  });
}
