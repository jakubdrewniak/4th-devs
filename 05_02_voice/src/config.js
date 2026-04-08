import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "../../config.js";

export const PROJECT_DIR = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
);
