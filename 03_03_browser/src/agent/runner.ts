import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { buildSystemPrompt } from '../prompt.js';
import { createFeedbackTracker } from '../feedback/index.js';
import type { FeedbackTracker } from '../feedback/index.js';
import { log } from '../log.js';
import type { ToolRegistry } from '../tools/index.js';
import {
  applyUsage,
  buildFunctionTools,
  createModelResponse,
  extractFunctionCalls,
  extractTextOutput,
  MAX_TURNS,
} from './model.js';
import { appendFinalDiscoveryTip, collectTurnInterventions, createInterventionState } from './interventions.js';
import { executeFunctionCall } from './tool-executor.js';
import type { AgentResult, TokenUsage } from './types.js';

export const runAgent = async (
  task: string,
  tools: ToolRegistry,
  previousResponseId?: string,
  feedbackTracker?: FeedbackTracker,
): Promise<AgentResult> => {
  const functionTools = buildFunctionTools(tools);
  const instructions = await buildSystemPrompt();
  const feedback = feedbackTracker ?? createFeedbackTracker();

  let responseId = previousResponseId;
  let input: string | ResponseInputItem[] = [{ role: 'user', content: task }];
  let interventionState = createInterventionState();
  const usage: TokenUsage = { input: 0, output: 0, cached: 0, total: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    log.turn(turn + 1, MAX_TURNS);
    log.thinking();

    const response = await createModelResponse({
      instructions,
      input,
      tools: functionTools,
      previousResponseId: responseId,
    });
    responseId = response.id;

    applyUsage(usage, response.usage);
    if (response.usage) {
      log.tokens(
        response.usage.input_tokens,
        response.usage.output_tokens,
        response.usage.input_tokens_details?.cached_tokens ?? 0,
      );
    }

    const functionCalls = extractFunctionCalls(response.output);
    if (functionCalls.length === 0) {
      const text = extractTextOutput(response.output) || '(no text output)';
      const finalResponse = appendFinalDiscoveryTip(text, feedback, interventionState);
      const stats = feedback.stats();

      log.totalTokens(usage.input, usage.output, usage.cached, usage.total);
      log.done(turn + 1, stats);

      return {
        response: finalResponse,
        turns: turn + 1,
        responseId: responseId!,
        usage,
      };
    }

    const toolResults: ResponseInputItem[] = [];
    let recoveredFromFailures = false;

    for (const call of functionCalls) {
      const result = await executeFunctionCall(call, tools, feedback);
      toolResults.push(result.item);
      recoveredFromFailures ||= result.recoveredAfterFailures;
    }

    const interventions = collectTurnInterventions(feedback, recoveredFromFailures, interventionState);
    interventionState = interventions.nextState;
    input = [...toolResults, ...interventions.items];
  }

  log.totalTokens(usage.input, usage.output, usage.cached, usage.total);
  log.maxTurns();

  return {
    response: 'Exceeded maximum turns',
    turns: MAX_TURNS,
    responseId: responseId!,
    usage,
  };
};
