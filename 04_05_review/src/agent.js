import { complete } from "./api.js";

const MAX_STEPS = 12;

export const runAgent = async ({
  input,
  instructions,
  model,
  tools,
}) => {
  const definitions = tools.map((tool) => tool.definition);
  const handlers = Object.fromEntries(
    tools.map((tool) => [tool.definition.name, tool.handler]),
  );

  let conversation = [{ role: "user", content: input }];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await complete({
      input: conversation,
      tools: definitions,
      instructions,
      model,
    });

    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      return {
        text: response.text,
        conversation,
      };
    }

    const results = [];

    for (const call of calls) {
      const handler = handlers[call.name];

      if (!handler) {
        throw new Error(`Unknown tool requested: ${call.name}`);
      }

      const args = JSON.parse(call.arguments ?? "{}");
      const output = await handler(args);

      results.push(call, {
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }

    conversation = [...conversation, ...results];
  }

  throw new Error(`Reviewer did not finish within ${MAX_STEPS} tool turns.`);
};
