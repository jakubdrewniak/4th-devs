const ALLOWED_FIELD_MODES = new Set(["exact", "semantic"]);
const ALLOWED_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

const fail = (message) => {
  throw new Error(`Invalid project config: ${message}`);
};

export const validateProject = ({ config, extractionSchema }) => {
  if (!config || typeof config !== "object") fail("config must export an object");
  if (typeof config.prompt !== "string" || !config.prompt) fail('"prompt" must be a non-empty string');
  if (typeof config.schema !== "string" || !config.schema) fail('"schema" must be a non-empty string');
  if (typeof config.testsDir !== "string" || !config.testsDir) fail('"testsDir" must be a non-empty string');

  const sections = config.evaluation?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    fail('"evaluation.sections" must be a non-empty array');
  }

  const candidates = config.optimization?.candidates;
  if (
    candidates !== undefined
    && (!Number.isInteger(candidates) || candidates <= 0)
  ) {
    fail('"optimization.candidates" must be a positive integer when provided');
  }

  const modelRoles = config.models;
  if (!modelRoles || typeof modelRoles !== "object") {
    fail('"models" must be an object');
  }

  for (const role of ["execution", "judge", "improver"]) {
    const profile = modelRoles[role];
    if (!profile || typeof profile !== "object") {
      fail(`"models.${role}" must be an object`);
    }

    if (typeof profile.model !== "string" || !profile.model.trim()) {
      fail(`"models.${role}.model" must be a non-empty string`);
    }

    if (profile.reasoning !== undefined) {
      if (!profile.reasoning || typeof profile.reasoning !== "object") {
        fail(`"models.${role}.reasoning" must be an object when provided`);
      }

      if (typeof profile.reasoning.effort !== "string" || !ALLOWED_REASONING_EFFORTS.has(profile.reasoning.effort)) {
        fail(`"models.${role}.reasoning.effort" must be one of ${[...ALLOWED_REASONING_EFFORTS].join(", ")}`);
      }
    }
  }

  if (!extractionSchema?.name || typeof extractionSchema.name !== "string") {
    fail('schema module must export an object with "name"');
  }

  if (!extractionSchema?.schema || typeof extractionSchema.schema !== "object") {
    fail('schema module must export an object with "schema"');
  }

  const rootProperties = extractionSchema.schema.properties ?? {};
  const seenKeys = new Set();
  let totalWeight = 0;

  for (const section of sections) {
    if (typeof section.key !== "string" || !section.key) fail("each section needs a non-empty key");
    if (seenKeys.has(section.key)) fail(`duplicate section key "${section.key}"`);
    seenKeys.add(section.key);

    if (typeof section.weight !== "number" || !Number.isFinite(section.weight) || section.weight <= 0) {
      fail(`section "${section.key}" must have a positive numeric weight`);
    }
    totalWeight += section.weight;

    if (!Array.isArray(section.matchBy) || section.matchBy.length === 0) {
      fail(`section "${section.key}" must define a non-empty matchBy array`);
    }

    if (!section.fields || typeof section.fields !== "object") {
      fail(`section "${section.key}" must define a fields object`);
    }

    for (const matchField of section.matchBy) {
      if (typeof matchField !== "string" || !matchField) {
        fail(`section "${section.key}" has an invalid matchBy field`);
      }
      if (!(matchField in section.fields)) {
        fail(`section "${section.key}" matchBy field "${matchField}" must also appear in fields`);
      }
    }

    const fieldEntries = Object.entries(section.fields);
    if (fieldEntries.length === 0) fail(`section "${section.key}" must define at least one field`);

    for (const [field, mode] of fieldEntries) {
      if (!ALLOWED_FIELD_MODES.has(mode)) {
        fail(`section "${section.key}" field "${field}" must be "exact" or "semantic"`);
      }
    }

    const schemaSection = rootProperties[section.key];
    if (!schemaSection) fail(`section "${section.key}" does not exist in the schema root`);
    if (schemaSection.type !== "array") fail(`section "${section.key}" must point to an array field in the schema root`);
  }

  if (Math.abs(totalWeight - 1) > 0.000001) {
    fail(`section weights must sum to 1. Received ${totalWeight}`);
  }
};
