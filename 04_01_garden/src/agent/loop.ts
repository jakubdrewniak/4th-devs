import { completion } from "../ai/client";
import { findTool, definitions } from "../tools";
import { config } from "../config";
import { loadTemplate } from "./template";
import { resolveSkillContext } from "./skill";
import { logToolCall, logToolResult, logBuiltinTools, logTurn } from "./log";
import type {
  ResponseInputItem,
  ResponseFunctionToolCall,
  ToolContext,
} from "../types";
import type { AgentResult } from "./types";

async function executeToolCall(
  call: ResponseFunctionToolCall,
  context: ToolContext,
): Promise<ResponseInputItem> {
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    logToolCall(call.name, args);

    const tool = findTool(call.name);
    const result = tool
      ? await tool.handler(args, context)
      : { ok: false, output: `Unknown tool: ${call.name}` };

    logToolResult(call.name, result.output, result.ok);
    return { type: "function_call_output", call_id: call.call_id, output: result.output };
  } catch (err) {
    const output = `Error: ${err instanceof Error ? err.message : String(err)}`;
    logToolResult(call.name, output, false);
    return { type: "function_call_output", call_id: call.call_id, output };
  }
}

export async function run(
  userMessage: string,
  context: ToolContext,
  agent = "main",
): Promise<AgentResult> {
  const template = await loadTemplate(agent);
  const skillContext = resolveSkillContext(
    userMessage,
    template.skills,
    template.tools,
  );
  const tools = definitions(skillContext.toolNames);

  let totalTokens = 0;
  let input: ResponseInputItem[] = [
    { role: "user", content: skillContext.userMessage },
  ];
  let previousResponseId: string | undefined;

  for (let turn = 0; turn < config.maxTurns; turn++) {
    logTurn(turn + 1);

    const response = await completion({
      model: template.model,
      instructions: template.instructions,
      input,
      tools,
      previousResponseId,
    });

    totalTokens += response.usage?.total_tokens ?? 0;
    logBuiltinTools(response.output);
    previousResponseId = response.id;

    const toolCalls = response.output.filter(
      (item): item is ResponseFunctionToolCall => item.type === "function_call",
    );
    if (toolCalls.length === 0) {
      return { text: response.output_text, turns: turn + 1, totalTokens };
    }

    input = await Promise.all(
      toolCalls.map((call) => executeToolCall(call, context)),
    );
  }

  return { text: "Max turns reached", turns: config.maxTurns, totalTokens };
}
