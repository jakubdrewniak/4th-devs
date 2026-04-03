/*
  Agent loop — orchestrates the tool-calling workflow.

  Flow:  user message → model → (optional tool calls → results → model) → final answer

  The model can request tool calls in its response. When it does, we execute
  them locally, feed the results back, and let the model continue. This repeats
  until the model produces a plain text answer or we hit MAX_STEPS.

  Agents can delegate tasks to other agents via the `delegate` tool.
  Recursion is depth-limited: child agents beyond MAX_DEPTH don't see the
  delegate tool, so they can't spawn further children.
*/

import { complete } from "./api.js";
import { tools, findHandler } from "./tools/registry.js";
import { definition as delegateDefinition, createRun as createDelegateRun } from "./tools/delegate.js";
import { logToolCall, logToolResult } from "./logger.js";

const MAX_STEPS = 10;
const MAX_DEPTH = 2;

export const chat = async (conversation, agent = {}) => {
  const { name: agentName, instructions, model, toolNames, depth = 0 } = agent;
  const canDelegate = depth < MAX_DEPTH;

  const availableTools = canDelegate
    ? [...tools(toolNames), delegateDefinition]
    : tools(toolNames);

  const runDelegate = canDelegate ? createDelegateRun(depth, chat) : null;

  const executeTool = async (call) => {
    const args = JSON.parse(call.arguments);
    const run = call.name === "delegate"
      ? runDelegate
      : findHandler(call.name);

    if (!run) throw new Error(`Unknown tool: ${call.name}`);

    logToolCall(call.name, args, agentName);
    const startMs = performance.now();
    const result = await run(args);
    logToolResult(call.name, result, agentName, performance.now() - startMs);

    return {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(result),
    };
  };

  let current = conversation;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await complete(current, availableTools, { instructions, model });
    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      const text = response.output_text
        ?? response.output.find((item) => item.type === "message")?.content?.[0]?.text
        ?? "No response";
      return { text, conversation: current };
    }

    const results = await Promise.all(calls.map(executeTool));
    current = [...current, ...calls, ...results];
  }

  throw new Error(`Tool loop did not finish within ${MAX_STEPS} steps.`);
};
