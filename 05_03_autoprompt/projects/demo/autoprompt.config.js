export default {
  name: "demo",
  prompt: "./prompt.initial.md",
  schema: "./schema.js",
  testsDir: "./test-data",
  models: {
    execution: {
      model: "gpt-5.4-mini",
      reasoning: { effort: "none" },
    },
    judge: {
      model: "gpt-5.4",
      reasoning: { effort: "high" },
    },
    improver: {
      model: "gpt-5.4",
      reasoning: { effort: "high" },
    },
  },
  optimization: {
    candidates: 3,
    cases: ["01", "02"],
    verifyCases: ["03"],
  },
  evaluation: {
    sections: [
      {
        key: "projects",
        weight: 0.15,
        matchBy: ["name"],
        fields: {
          name: "semantic",
          status: "exact",
          owner: "exact",
          priority: "exact",
        },
      },
      {
        key: "tasks",
        weight: 0.4,
        matchBy: ["task", "project"],
        fields: {
          task: "semantic",
          project: "exact",
          assignee: "exact",
          status: "exact",
          deadline: "exact",
        },
      },
      {
        key: "decisions",
        weight: 0.2,
        matchBy: ["decision"],
        fields: {
          decision: "semantic",
          date: "exact",
        },
      },
      {
        key: "people",
        weight: 0.25,
        matchBy: ["name"],
        fields: {
          name: "semantic",
          role: "semantic",
        },
      },
    ],
  },
};
