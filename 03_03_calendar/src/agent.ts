import { complete, type InputItem, type Tool } from './core/completion.js';
import { getEvents } from './data/calendar.js';
import { buildMetadata, setTime, setUserLocation } from './data/environment.js';
import { listNotifications } from './data/notifications.js';
import { addScenario, notificationWebhooks } from './data/scenarios.js';
import * as log from './logger.js';
import { buildAddPhasePrompt, buildNotificationPhasePrompt } from './prompt.js';
import { addPhaseTools, notificationPhaseTools, allTools } from './tools/index.js';
import type { ToolDefinition } from './types.js';

interface RunStepResult {
  id: string;
  turns: number;
  toolCalls: number;
  response: string;
}

export interface AgentResult {
  model: string;
  addPhase: RunStepResult[];
  notificationPhase: RunStepResult[];
  eventsCreated: number;
  notificationsSent: number;
}

interface ToolLoopParams {
  model: string;
  instructions: string;
  message: string;
  tools: ToolDefinition[];
  maxTurns?: number;
}

const asResponseTools = (tools: ToolDefinition[]): Tool[] =>
  tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: null,
  }));

const runToolLoop = async (params: ToolLoopParams): Promise<{ text: string; turns: number; toolCalls: number }> => {
  const input: InputItem[] = [{ role: 'user', content: params.message }];
  const tools = asResponseTools(params.tools);
  const maxTurns = params.maxTurns ?? 12;
  let totalToolCalls = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    log.turnHeader(turn);

    const result = await complete({
      model: params.model,
      instructions: params.instructions,
      input,
      tools,
    });

    if (result.toolCalls.length === 0) {
      return {
        text: result.outputText ?? '',
        turns: turn,
        toolCalls: totalToolCalls,
      };
    }

    for (const item of result.output) {
      input.push(item as InputItem);
    }

    for (const call of result.toolCalls) {
      totalToolCalls += 1;
      const tool = params.tools.find((candidate) => candidate.name === call.name);
      if (!tool) {
        log.toolError(call.name, 'Unknown tool');
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: `Unknown tool: ${call.name}`,
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        log.toolError(call.name, 'Invalid JSON arguments');
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: 'Error: invalid JSON arguments',
        });
        continue;
      }

      log.toolCall(call.name, args);

      try {
        const output = await tool.handler(args);
        const outputStr = JSON.stringify(output);
        log.toolResult(call.name, outputStr);
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: outputStr,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.toolError(call.name, message);
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: `Error: ${message}`,
        });
      }
    }
  }

  return {
    text: 'Reached max turn limit before completion.',
    turns: maxTurns,
    toolCalls: totalToolCalls,
  };
};

export const runAgent = async (model: string): Promise<AgentResult> => {
  const addPhase: RunStepResult[] = [];
  const notificationPhase: RunStepResult[] = [];

  log.banner(model, allTools.length);

  // ── Phase 1: Add events ────────────────────────────────────────────

  log.phaseHeader(1, 'Add Events', `${addScenario.length} user requests to schedule`);

  for (const step of addScenario) {
    setTime(step.at);
    setUserLocation(step.locationId);

    const meta = buildMetadata();
    log.stepHeader(step.id, step.message);
    log.metadata(meta);

    const result = await runToolLoop({
      model,
      instructions: buildAddPhasePrompt(),
      message: `${meta}\n\n${step.message}`,
      tools: addPhaseTools,
    });

    log.stepResult(result.text, result.turns, result.toolCalls);

    addPhase.push({
      id: step.id,
      turns: result.turns,
      toolCalls: result.toolCalls,
      response: result.text,
    });
  }

  // ── Phase 2: Notification webhooks ─────────────────────────────────

  log.phaseHeader(2, 'Notifications', `${notificationWebhooks.length} upcoming-event webhooks`);

  for (const webhook of notificationWebhooks) {
    setTime(webhook.at);
    setUserLocation(webhook.locationId);

    const meta = buildMetadata();
    const payloadText = JSON.stringify(webhook.payload, null, 2);
    const label = `${webhook.payload.eventTitle} (starts ${webhook.payload.startsAt.slice(11, 16)})`;

    log.stepHeader(webhook.id, label);
    log.metadata(meta);

    const result = await runToolLoop({
      model,
      instructions: buildNotificationPhasePrompt(),
      message:
        `${meta}\n\n` +
        `Webhook payload:\n${payloadText}\n\n` +
        'Use tools, send exactly one notification, then summarize what you sent.',
      tools: notificationPhaseTools,
    });

    log.stepResult(result.text, result.turns, result.toolCalls);

    notificationPhase.push({
      id: webhook.id,
      turns: result.turns,
      toolCalls: result.toolCalls,
      response: result.text,
    });
  }

  // ── Final tables ───────────────────────────────────────────────────

  log.eventTable(
    getEvents().map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      isVirtual: e.isVirtual,
      locationName: e.locationName,
    })),
  );

  log.notificationTable(
    listNotifications().map((n) => ({
      id: n.id,
      createdAt: n.createdAt,
      channel: n.channel,
      title: n.title,
      message: n.message,
    })),
  );

  log.done();

  return {
    model,
    addPhase,
    notificationPhase,
    eventsCreated: getEvents().length,
    notificationsSent: listNotifications().length,
  };
};
