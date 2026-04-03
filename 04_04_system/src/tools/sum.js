/*
  Tool: sum

  Each tool has two parts:
  - `definition`  — JSON Schema sent to the model so it knows *what* the tool does and *what arguments* to pass.
                    The model never runs the tool — it only decides when to call it.
  - `handler`     — the actual function that runs on our side when the model requests a call.
*/

export const definition = {
  type: "function",
  name: "sum",
  description: "Add two numbers together and return the result",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
    additionalProperties: false,
  },
  strict: true,
};

export const handler = ({ a, b }) => ({ result: a + b });
