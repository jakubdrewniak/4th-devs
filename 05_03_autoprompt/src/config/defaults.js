import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const RUNS_DIR = resolve(REPO_ROOT, "runs");
export const MODEL = "gpt-5.4";
export const DEFAULT_MODEL_PROFILES = {
  execution: { model: MODEL },
  judge: { model: MODEL },
  improver: { model: MODEL },
};
export const MAX_ITERATIONS = 10;
export const EVAL_RUNS = 1;
export const CANDIDATE_COUNT = 3;
