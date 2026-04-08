export const formatEvaluationPolicy = (evaluation) => evaluation.sections.map((section) => {
  const fieldLines = Object.entries(section.fields)
    .map(([field, mode]) => `  - ${field}: ${mode}`)
    .join("\n");

  return [
    `Section: ${section.key}`,
    `- Weight: ${section.weight}`,
    `- Match items by: ${section.matchBy.join(", ")}`,
    "- Fields:",
    fieldLines,
  ].join("\n");
}).join("\n\n");
