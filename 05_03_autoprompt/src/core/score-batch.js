import { complete } from "../llm/complete.js";
import { buildJudgeSystem } from "../prompts/judge-system.js";

const buildJudgeSchema = (caseIds, sections) => ({
  name: "batch_evaluation",
  schema: {
    type: "object",
    properties: Object.fromEntries(
      caseIds.map((id) => [
        `case_${id}`,
        {
          type: "object",
          properties: Object.fromEntries(
            sections.map((section) => [
              section.key,
              {
                type: "object",
                properties: {
                  score: { type: "number" },
                  issues: { type: "array", items: { type: "string" } },
                },
                required: ["score", "issues"],
              },
            ]),
          ),
          required: sections.map((section) => section.key),
        },
      ]),
    ),
    required: caseIds.map((id) => `case_${id}`),
  },
});

export const scoreBatch = async (cases, evaluation, models) => {
  const caseIds = cases.map((testCase) => testCase.id);

  const caseSections = cases.map((testCase) => [
    `## Case ${testCase.id}`,
    `\n**Expected:**\n\`\`\`json\n${JSON.stringify(testCase.expected, null, 2)}\n\`\`\``,
    `\n**Actual:**\n\`\`\`json\n${JSON.stringify(testCase.actual, null, 2)}\n\`\`\``,
  ].join("\n")).join("\n\n---\n\n");

  const raw = await complete(
    buildJudgeSystem(evaluation),
    caseSections,
    {
      model: models.judge.model,
      reasoning: models.judge.reasoning,
      jsonSchema: buildJudgeSchema(caseIds, evaluation.sections),
      stage: `judge/cases_${caseIds.join("+")}`,
    },
  );

  const judgment = JSON.parse(raw);
  const results = [];

  for (const testCase of cases) {
    const caseJudgment = judgment[`case_${testCase.id}`];
    let total = 0;
    const breakdown = {};

    for (const section of evaluation.sections) {
      const score = Math.max(0, Math.min(1, caseJudgment?.[section.key]?.score ?? 0));
      const issues = caseJudgment?.[section.key]?.issues ?? [];
      total += score * section.weight;
      breakdown[section.key] = {
        score: Math.round(score * 10000) / 10000,
        weight: section.weight,
        issues,
      };
    }

    results.push({
      id: testCase.id,
      score: Math.round(total * 10000) / 10000,
      breakdown,
      actual: testCase.actual,
      expected: testCase.expected,
      error: null,
    });
  }

  return results;
};
