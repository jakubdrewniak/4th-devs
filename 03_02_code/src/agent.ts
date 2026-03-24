import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../config.js';
import OpenAI from 'openai';
import { buildSystemPrompt } from './prompt.js';
import type { PermissionLevel, ToolDefinition } from './types.js';

type Message = OpenAI.ChatCompletionMessageParam;

const openai = new OpenAI({ apiKey: AI_API_KEY, baseURL: CHAT_API_BASE_URL, defaultHeaders: EXTRA_API_HEADERS });
const MODEL = resolveModelForProvider(process.env.MODEL ?? 'gpt-5.2');
const MAX_TURNS = 25;

const truncate = (s: string, max = 200): string =>
  s.length > max ? s.slice(0, max) + '…' : s;

export interface AgentConfig {
  permissionLevel?: PermissionLevel;
  tools: Record<string, ToolDefinition>;
}

export interface AgentResult {
  response: string;
  turns: number;
}

export const runAgent = async (
  task: string,
  config: AgentConfig,
): Promise<AgentResult> => {
  const { tools } = config;
  const permissionLevel = config.permissionLevel ?? 'standard';

  const openaiTools: OpenAI.ChatCompletionTool[] = Object.entries(tools).map(([name, def]) => ({
    type: 'function',
    function: { name, description: def.description, parameters: def.parameters },
  }));

  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(permissionLevel) },
    { role: 'user', content: task },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n  [agent] Turn ${turn + 1}, ${messages.length} messages`);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: openaiTools,
    });

    const message = response.choices[0]?.message;
    if (!message) return { response: 'No response from model', turns: turn + 1 };

    messages.push(message);

    if (!message.tool_calls?.length) {
      console.log(`  [agent] Done (${turn + 1} turns)`);
      return { response: message.content ?? '', turns: turn + 1 };
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Unknown type: ${toolCall.type}` });
        continue;
      }

      const { name } = toolCall.function;
      const tool = tools[name];

      if (!tool) {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Unknown tool: ${name}` });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Error: Invalid JSON in tool arguments' });
        continue;
      }

      console.log(`  [agent] ${name}(${truncate(JSON.stringify(args))})`);

      try {
        const result = await tool.handler(args);
        const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        console.log(`  [agent] → ${truncate(output)}`);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: output });
      } catch (err) {
        const msg = `Error: ${err instanceof Error ? err.message : String(err)}`;
        console.log(`  [agent] → ${truncate(msg)}`);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: msg });
      }
    }
  }

  return { response: 'Exceeded maximum turns', turns: MAX_TURNS };
};
