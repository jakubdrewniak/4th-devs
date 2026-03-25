import { MAX_TURNS, MODEL, WORKSPACE } from './config.js';
import {
  buildFunctionResult,
  callInteraction,
  extractFunctionCalls,
  extractText,
} from './gemini.js';
import type { FunctionToolDef } from './types/gemini.js';
import { createAgentHooks, listRecentSessions } from './hooks.js';
import { log } from './log.js';
import { buildSystemPrompt } from './prompt.js';
import { tools } from './tools.js';

const functionToolDefs: FunctionToolDef[] = Object.entries(tools).map(([name, t]) => ({
  type: 'function',
  name,
  description: t.description,
  parameters: t.parameters,
}));

export const runAgent = async (
  userMessage: string,
  previousResponseId?: string,
): Promise<{ text: string; responseId: string }> => {
  const currentDate = new Date().toISOString().slice(0, 10);
  const sessionId = `${currentDate}-${crypto.randomUUID().slice(0, 8)}`;
  const recentSessions = await listRecentSessions(3);
  const hooks = createAgentHooks({ currentDate, sessionId, recentSessions });
  const systemPrompt = buildSystemPrompt({ currentDate, sessionId, recentSessions });

  let responseId = previousResponseId;
  let input: unknown = userMessage;
  let finalText = '';

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    log.turn(turn);
    let interaction;
    try {
      interaction = await callInteraction({
        model: MODEL,
        input,
        system_instruction: systemPrompt,
        tools: functionToolDefs,
        generation_config: { temperature: 0.3, thinking_level: 'low' },
        ...(responseId ? { previous_interaction_id: responseId } : {}),
      });
      responseId = interaction.id;
    } catch (error) {
      log.warn(error instanceof Error ? error.message : String(error));
      break;
    }

    const calls = extractFunctionCalls(interaction.outputs);
    const text = extractText(interaction.outputs);

    if (calls.length === 0) {
      const check = hooks.beforeFinish(text);
      if (!check.allow && turn < MAX_TURNS) {
        log.hook('beforeFinish', `missing: ${check.missing.join(', ')}`);
        input = [{ type: 'text', text: check.inject_message ?? 'Complete remaining actions.' }];
        continue;
      }
      finalText = text || hooks.buildFallbackTextFeedback();
      break;
    }

    const results = [];
    for (const call of calls) {
      const tool = tools[call.name];
      hooks.beforeToolCall(call.name, call.arguments);

      if (!tool) {
        log.tool(call.name, 'unknown tool');
        results.push(buildFunctionResult(call.id, call.name, `Unknown tool: ${call.name}`, true));
        continue;
      }

      let output: string;
      try {
        output = await tool.handler(call.arguments);
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      const processed = hooks.afterToolResult(call.name, call.arguments, output);
      log.tool(call.name, processed.log_summary ?? processed.output);
      results.push(buildFunctionResult(call.id, call.name, processed.output));
    }

    input = results;
  }

  if (!finalText) finalText = hooks.buildFallbackTextFeedback();
  return { text: finalText, responseId: responseId ?? previousResponseId ?? '' };
};
