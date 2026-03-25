import type { ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import { jsonrepair } from 'jsonrepair';
import type { FeedbackTracker } from '../feedback/index.js';
import { log } from '../log.js';
import type { ToolOutput, ToolRegistry } from '../tools/index.js';
import type { ExecutedToolCall } from './types.js';

const isStructuredOutput = (result: ToolOutput): result is Exclude<ToolOutput, string> =>
  Array.isArray(result);

const isEmptyStringResult = (result: string): boolean =>
  result === 'null' || result === '{}' || result === '[]';

const hasNullTitleAuthorPair = (result: string): boolean =>
  result.includes('"title":null') && result.includes('"author":null');

const enrichOutput = (base: string, hints: string[]): string =>
  hints.length ? `${base}\n\n[feedback] ${hints.join(' | ')}` : base;

const buildErrorOutput = (error: string, hints: string[]): string =>
  [`Error: ${error}`, ...hints.map((hint) => `[feedback] ${hint}`)].join('\n');

const buildFailureResult = (
  callId: string,
  output: string,
  recoveredAfterFailures = false,
): ExecutedToolCall => ({
  item: { type: 'function_call_output', call_id: callId, output } satisfies ResponseInputItem,
  outcome: 'fail',
  recoveredAfterFailures,
});

const buildSuccessResult = (
  callId: string,
  output: string | Exclude<ToolOutput, string>,
  recoveredAfterFailures = false,
): ExecutedToolCall => ({
  item: { type: 'function_call_output', call_id: callId, output } satisfies ResponseInputItem,
  outcome: 'success',
  recoveredAfterFailures,
});

const compactPreview = (raw: string, max = 180): string => {
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const parseArguments = (
  raw: string,
): { args: Record<string, unknown>; repaired: boolean } | { error: string; preview: string; length: number } => {
  try {
    return { args: JSON.parse(raw) as Record<string, unknown>, repaired: false };
  } catch (initialError) {
    try {
      const repairedRaw = jsonrepair(raw);
      return { args: JSON.parse(repairedRaw) as Record<string, unknown>, repaired: true };
    } catch (repairError) {
      const initialReason = initialError instanceof Error ? initialError.message : String(initialError);
      const repairReason = repairError instanceof Error ? repairError.message : String(repairError);
      const reason = `${initialReason} | repair failed: ${repairReason}`;
      return {
        error: reason,
        preview: compactPreview(raw),
        length: raw.length,
      };
    }
  }
};

const repairHint = (toolName: string): string =>
  toolName === 'fs_write'
    ? 'JSON was auto-repaired before executing fs_write. Keep arguments strict JSON next time to avoid content corruption.'
    : 'JSON was auto-repaired before tool execution. Prefer strict JSON arguments.';

const fsWriteHtmlHint = (args: Record<string, unknown>): string[] => {
  if (!('content' in args)) return [];
  const content = args.content;
  if (typeof content !== 'string') return [];
  if (!content.includes('<') || !content.includes('>')) return [];
  return ['fs_write received HTML content; if failures continue, write in smaller create/append chunks.'];
};

const ensureFsWriteContentString = (args: Record<string, unknown>): string | null => {
  if (!('content' in args)) return null;
  if (typeof args.content === 'string') return null;
  return 'fs_write.content must be a string';
};

const ensureFsWriteRequiredArgs = (args: Record<string, unknown>): string | null => {
  const required = ['path', 'operation', 'content'];
  const missing = required.filter((key) => !(key in args));
  if (missing.length === 0) return null;
  return `fs_write is missing required argument(s): ${missing.join(', ')}`;
};

const validateToolArguments = (toolName: string, args: Record<string, unknown>): string | null => {
  if (toolName !== 'fs_write') return null;

  const requiredError = ensureFsWriteRequiredArgs(args);
  if (requiredError) return requiredError;

  return ensureFsWriteContentString(args);
};

export const executeFunctionCall = async (
  call: ResponseFunctionToolCall,
  tools: ToolRegistry,
  feedback: FeedbackTracker,
): Promise<ExecutedToolCall> => {
  const tool = tools[call.name];
  if (!tool) {
    const message = `Unknown tool: ${call.name}`;
    log.error(`unknown tool: ${call.name}`);
    feedback.record({ tool: call.name, outcome: 'fail', args: {}, error: message, ts: Date.now() });
    return buildFailureResult(
      call.call_id,
      buildErrorOutput(message, ['Use one of the provided tool names from the current tool list.']),
    );
  }

  const parsed = parseArguments(call.arguments);
  if ('error' in parsed) {
    const message = `Invalid JSON arguments for ${call.name}: ${parsed.error}`;
    log.error(`invalid JSON args for ${call.name}: ${parsed.error}`);
    feedback.record({ tool: call.name, outcome: 'fail', args: {}, error: message, ts: Date.now() });
    const hints = feedback.generateHints(call.name, 'fail', message);
    hints.forEach((hint) => log.hint(hint));
    return buildFailureResult(
      call.call_id,
      buildErrorOutput(message, [
        `Received ${parsed.length} argument chars.`,
        `Raw args preview: ${parsed.preview || '(empty)'}`,
        ...hints,
      ]),
    );
  }
  const args = parsed.args;
  if (parsed.repaired) {
    log.hint(repairHint(call.name));
  }

  const validationError = validateToolArguments(call.name, args);
  if (validationError) {
    log.error(validationError);
    feedback.record({ tool: call.name, outcome: 'fail', args, error: validationError, ts: Date.now() });
    return buildFailureResult(
      call.call_id,
      buildErrorOutput(validationError, [
        'Check the fs_write schema and provide { path, operation, content } with content as a string.',
      ]),
    );
  }

  const failuresBeforeCall = feedback.consecutiveFailures();
  log.toolCall(call.name, args);

  try {
    const result = await tool.handler(args);

    if (isStructuredOutput(result)) {
      feedback.record({ tool: call.name, outcome: 'success', args, ts: Date.now() });
      log.toolOk(call.name, `[structured output, ${result.length} item(s)]`);
      return buildSuccessResult(call.call_id, result, failuresBeforeCall >= 2);
    }

    if (isEmptyStringResult(result) || hasNullTitleAuthorPair(result)) {
      feedback.record({
        tool: call.name,
        outcome: 'fail',
        args,
        error: 'empty result',
        ts: Date.now(),
      });
      log.toolEmpty(call.name);
      const hints = feedback.generateHints(call.name, 'fail', 'empty result');
      hints.forEach((hint) => log.hint(hint));
      return buildFailureResult(call.call_id, enrichOutput(result, hints));
    }

    feedback.record({ tool: call.name, outcome: 'success', args, ts: Date.now() });
    log.toolOk(call.name, result);
    const hints = feedback.generateHints(call.name, 'success');
    hints.push(...fsWriteHtmlHint(args));
    hints.forEach((hint) => log.hint(hint));
    return buildSuccessResult(call.call_id, enrichOutput(result, hints), failuresBeforeCall >= 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    feedback.record({ tool: call.name, outcome: 'fail', args, error: message, ts: Date.now() });
    log.toolFail(call.name, message);
    const hints = feedback.generateHints(call.name, 'fail', message);
    hints.forEach((hint) => log.hint(hint));
    return buildFailureResult(call.call_id, buildErrorOutput(message, hints));
  }
};
