const EXTRACTION_SCHEMA = {
  name: "project_state",
  schema: {
    type: "object",
    properties: {
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["active", "paused", "completed"] },
            owner: { type: ["string", "null"] },
            priority: { type: ["string", "null"], enum: ["P1", "P2", "research", null] },
          },
          required: ["name", "status"],
        },
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task: { type: "string" },
            project: { type: ["string", "null"] },
            assignee: { type: ["string", "null"] },
            status: { type: "string", enum: ["todo", "in_progress", "done", "paused", "blocked"] },
            deadline: { type: ["string", "null"] },
          },
          required: ["task", "status"],
        },
      },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            decision: { type: "string" },
            date: { type: ["string", "null"] },
          },
          required: ["decision"],
        },
      },
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["name", "role"],
        },
      },
    },
    required: ["projects", "tasks", "decisions", "people"],
  },
};

export default EXTRACTION_SCHEMA;
export { EXTRACTION_SCHEMA };
