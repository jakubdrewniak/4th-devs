import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_MODEL_PROFILES } from "../config/defaults.js";
import { validateProject } from "./validate-project.js";

const loadModule = async (filePath) => import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);

const normalizeSchemaExport = (schemaModule) => {
  if (schemaModule.default?.name && schemaModule.default?.schema) return schemaModule.default;
  if (schemaModule.EXTRACTION_SCHEMA?.name && schemaModule.EXTRACTION_SCHEMA?.schema) return schemaModule.EXTRACTION_SCHEMA;
  throw new Error('Schema module must export { name, schema } as default export or EXTRACTION_SCHEMA');
};

const normalizeModelProfile = (profile, fallback) => ({
  model: profile?.model ?? fallback.model,
  ...(profile?.reasoning ? { reasoning: { ...profile.reasoning } } : fallback.reasoning ? { reasoning: { ...fallback.reasoning } } : {}),
});

const normalizeModels = (models) => ({
  execution: normalizeModelProfile(models?.execution, DEFAULT_MODEL_PROFILES.execution),
  judge: normalizeModelProfile(models?.judge, DEFAULT_MODEL_PROFILES.judge),
  improver: normalizeModelProfile(models?.improver, DEFAULT_MODEL_PROFILES.improver),
});

const loadTestCases = (testsDir) => {
  const inputFiles = readdirSync(testsDir)
    .filter((fileName) => fileName.startsWith("input_") && fileName.endsWith(".md"))
    .sort();

  if (inputFiles.length === 0) {
    throw new Error(`No test cases found in ${testsDir}. Expected files named input_XX.md`);
  }

  return inputFiles.map((fileName) => {
    const id = fileName.replace("input_", "").replace(".md", "");
    const input = readFileSync(resolve(testsDir, fileName), "utf-8");
    const expectedPath = resolve(testsDir, `expected_${id}.json`);
    const contextPath = resolve(testsDir, `context_${id}.json`);
    const priorPath = resolve(testsDir, `prior_${id}.json`);

    if (!existsSync(expectedPath)) {
      throw new Error(`Missing expected file for test case ${id}: ${expectedPath}`);
    }

    return {
      id,
      input,
      expected: JSON.parse(readFileSync(expectedPath, "utf-8")),
      context: existsSync(contextPath)
        ? JSON.parse(readFileSync(contextPath, "utf-8"))
        : existsSync(priorPath)
          ? JSON.parse(readFileSync(priorPath, "utf-8"))
          : null,
    };
  });
};

export const loadProject = async (projectArg) => {
  const projectDir = resolve(projectArg);
  const configPath = resolve(projectDir, "autoprompt.config.js");

  if (!existsSync(configPath)) {
    throw new Error(`Missing project config: ${configPath}`);
  }

  const configModule = await loadModule(configPath);
  const rawConfig = configModule.default ?? configModule;
  const config = {
    ...rawConfig,
    models: normalizeModels(rawConfig.models),
    optimization: rawConfig.optimization ?? {},
  };
  const schemaPath = resolve(projectDir, config.schema);
  const promptPath = resolve(projectDir, config.prompt);
  const testsDir = resolve(projectDir, config.testsDir);

  if (!existsSync(schemaPath)) throw new Error(`Schema file not found: ${schemaPath}`);
  if (!existsSync(promptPath)) throw new Error(`Prompt file not found: ${promptPath}`);
  if (!existsSync(testsDir)) throw new Error(`Tests directory not found: ${testsDir}`);

  const extractionSchema = normalizeSchemaExport(await loadModule(schemaPath));
  validateProject({ config, extractionSchema });

  const allCases = loadTestCases(testsDir);
  const optimizeCaseIds = config.optimization?.cases ?? null;
  const verifyCaseIds = config.optimization?.verifyCases ?? null;

  const optimizeCases = optimizeCaseIds
    ? allCases.filter((tc) => optimizeCaseIds.includes(tc.id))
    : allCases;

  const verifyCases = verifyCaseIds
    ? allCases.filter((tc) => verifyCaseIds.includes(tc.id))
    : allCases;

  return {
    name: config.name || basename(projectDir),
    dir: projectDir,
    configPath,
    promptPath,
    initialPrompt: readFileSync(promptPath, "utf-8"),
    extractionSchema,
    evaluation: config.evaluation,
    models: config.models,
    optimization: config.optimization,
    testCases: optimizeCases,
    verifyCases,
  };
};
