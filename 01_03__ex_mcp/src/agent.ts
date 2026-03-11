import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callMcpTool, mcpToolsToOpenAI } from "./mcp/client.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MODEL = "openai/gpt-4.1-mini";
const MAX_TOOL_ROUNDS = 5;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Message =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export const runAgent = async (
  history: Message[],
  userMessage: string,
  mcpClient: Client,
  mcpTools: Tool[]
): Promise<{ reply: string; history: Message[] }> => {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const tools = mcpToolsToOpenAI(mcpTools);

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    }

    const msg = data.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      const reply: string = msg.content ?? "";
      console.log(`[Agent] reply: ${reply}`);

      // return only the user+assistant turns (no system) as updated history
      const updatedHistory = messages.slice(1) as Message[];
      return { reply, history: updatedHistory };
    }

    console.log(`[Agent] tool calls: ${msg.tool_calls.map((c: ToolCall) => c.function.name).join(", ")}`);

    for (const call of msg.tool_calls as ToolCall[]) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      console.log(`[Agent]   → ${name}(${JSON.stringify(args)})`);

      let result: unknown;
      try {
        result = await callMcpTool(mcpClient, name, args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      console.log(`[Agent]   ← ${JSON.stringify(result)}`);

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  const fallback = "Przepraszam, chwilowo nie mogę przetworzyć żądania. Spróbuj ponownie.";
  const updatedHistory = messages.slice(1) as Message[];
  return { reply: fallback, history: updatedHistory };
};
