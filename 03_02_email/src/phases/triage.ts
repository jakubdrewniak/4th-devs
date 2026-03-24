import { allTools, toolMap } from '../tools/index.js';
import { emails } from '../data/mock-inbox.js';
import { classifyContact, KB_CATEGORIES } from '../data/contacts.js';
import { complete, type InputItem, type Tool } from '../core/completion.js';
import { buildTriagePrompt } from '../prompts/triage.js';
import type { ReplyPlan } from '../types.js';

interface TriageTracker {
  snapshot: () => void;
  collectKnowledgeAccess: () => unknown[];
  collectChanges: () => unknown[];
}

export interface TriageHooks {
  onSystemPromptInfo?: (prompt: string) => void;
  onTurnHeader?: (turn: number, messageCount: number) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, output: string) => void;
  onToolError?: (name: string, error: string) => void;
  onTurnKnowledgeAccess?: (accesses: unknown[]) => void;
  onTurnChanges?: (changes: unknown[]) => void;
}

export interface TriageOptions {
  tracker?: TriageTracker;
  hooks?: TriageHooks;
  maxTurns?: number;
}

const markForReplySchema: Tool = {
  type: 'function',
  name: 'mark_for_reply',
  description:
    'Mark an email as needing a reply. A separate, isolated draft session will be created for it. ' +
    'KB access in the draft session will be scoped based on the sender\'s contact type.',
  parameters: {
    type: 'object',
    properties: {
      email_id: { type: 'string', description: 'ID of the email to reply to' },
      account: { type: 'string', description: 'Account that received the email' },
      reason: { type: 'string', description: 'Brief reason a reply is needed' },
    },
    required: ['email_id', 'account', 'reason'],
    additionalProperties: false,
  },
  strict: null,
};

const handleMarkForReply = (
  args: Record<string, unknown>,
  plans: ReplyPlan[],
): string => {
  const emailId = args.email_id as string;
  const account = args.account as string;
  const email = emails.find((e) => e.id === emailId);
  if (!email) return JSON.stringify({ error: `Email not found: ${emailId}` });

  const contactType = classifyContact(account, email.from);
  const categories = KB_CATEGORIES[contactType];

  plans.push({ emailId, account, recipientEmail: email.from, contactType, reason: args.reason as string, categories });

  return JSON.stringify({
    marked: true,
    email_id: emailId,
    recipient: email.from,
    contact_type: contactType,
    kb_categories_allowed: categories,
  });
};

const MAX_TURNS = 12;
const noop = () => {};
const noopTracker: TriageTracker = {
  snapshot: noop,
  collectKnowledgeAccess: () => [],
  collectChanges: () => [],
};

const withDefaultHooks = (hooks?: TriageHooks): Required<TriageHooks> => ({
  onSystemPromptInfo: hooks?.onSystemPromptInfo ?? noop,
  onTurnHeader: hooks?.onTurnHeader ?? noop,
  onToolCall: hooks?.onToolCall ?? noop,
  onToolResult: hooks?.onToolResult ?? noop,
  onToolError: hooks?.onToolError ?? noop,
  onTurnKnowledgeAccess: hooks?.onTurnKnowledgeAccess ?? noop,
  onTurnChanges: hooks?.onTurnChanges ?? noop,
});

export interface TriageResult {
  turns: number;
  replyPlans: ReplyPlan[];
}

export const runTriagePhase = async (
  model: string,
  task: string,
  options: TriageOptions = {},
): Promise<TriageResult> => {
  const replyPlans: ReplyPlan[] = [];
  const instructions = buildTriagePrompt();
  const hooks = withDefaultHooks(options.hooks);
  const tracker = options.tracker ?? noopTracker;
  const maxTurns = options.maxTurns ?? MAX_TURNS;

  hooks.onSystemPromptInfo(instructions);

  const tools: Tool[] = [
    ...allTools.map((t): Tool => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: null,
    })),
    markForReplySchema,
  ];

  const input: InputItem[] = [
    { role: 'user', content: task },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    hooks.onTurnHeader(turn + 1, input.length);
    tracker.snapshot();

    const result = await complete({ model, instructions, input, tools });

    if (result.toolCalls.length === 0) {
      hooks.onTurnKnowledgeAccess(tracker.collectKnowledgeAccess());
      hooks.onTurnChanges(tracker.collectChanges());
      return { turns: turn + 1, replyPlans };
    }

    for (const item of result.output) {
      input.push(item as InputItem);
    }

    for (const tc of result.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        input.push({ type: 'function_call_output', call_id: tc.call_id, output: 'Error: Invalid JSON' });
        continue;
      }

      hooks.onToolCall(tc.name, args);

      if (tc.name === 'mark_for_reply') {
        const output = handleMarkForReply(args, replyPlans);
        hooks.onToolResult(tc.name, output);
        input.push({ type: 'function_call_output', call_id: tc.call_id, output });
        continue;
      }

      const tool = toolMap.get(tc.name);
      if (!tool) {
        hooks.onToolError(tc.name, 'Unknown tool');
        input.push({ type: 'function_call_output', call_id: tc.call_id, output: `Unknown tool: ${tc.name}` });
        continue;
      }

      try {
        const toolResult = await tool.handler(args);
        const output = JSON.stringify(toolResult);
        hooks.onToolResult(tc.name, output);
        input.push({ type: 'function_call_output', call_id: tc.call_id, output });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        hooks.onToolError(tc.name, msg);
        input.push({ type: 'function_call_output', call_id: tc.call_id, output: `Error: ${msg}` });
      }
    }

    hooks.onTurnKnowledgeAccess(tracker.collectKnowledgeAccess());
    hooks.onTurnChanges(tracker.collectChanges());
  }

  return { turns: maxTurns, replyPlans };
};
