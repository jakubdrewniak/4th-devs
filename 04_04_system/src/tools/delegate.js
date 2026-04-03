/*
  Tool: delegate

  Lets one agent hand off a task to another agent. The child agent runs
  its own loop with its own model, tools, and instructions — then returns
  a text result to the parent.

  `createRun` is a factory: it receives the current recursion depth
  and a reference to the chat function (to avoid circular imports).
*/

import { loadAgent } from "../loader.js";

export const definition = {
  type: "function",
  name: "delegate",
  description:
    "Delegate a task to another agent by name. The agent runs independently " +
    "and returns its text result. Use when a task is better handled by a specialist.",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Agent name (filename without .md, e.g. 'ellie')" },
      task: { type: "string", description: "Clear task description for the agent" },
    },
    required: ["agent", "task"],
    additionalProperties: false,
  },
  strict: true,
};

export const createRun = (depth, chatFn) => async ({ agent: name, task }) => {
  const child = await loadAgent(name);
  const { text } = await chatFn(
    [{ role: "user", content: task }],
    { ...child, depth: depth + 1 },
  );
  return { agent: child.name, result: text };
};
