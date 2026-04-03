import { complete, extractText, extractToolCalls } from "./api.js";
import { appConfig, hasAiAccess } from "./config.js";

const MAX_TOOL_ROUNDS = 8;

const AGENT_INSTRUCTIONS = `You are a marketing operations assistant for a SaaS company.
You help the user manage their daily marketing work across these workflows:

## Workflows & tools

1. **Todos** — open_todo_board, list_todos, add_todo, complete_todo, reopen_todo, remove_todo.
2. **Campaign review** — get_campaign_report (single campaign detail view), compare_campaigns (side-by-side comparison), open_newsletter_dashboard (all campaigns overview), list_campaigns.
3. **Sales analytics** — open_sales_analytics (scoped by date range and product), get_sales_report (legacy 30-day overview).
4. **Coupon management** — open_coupon_manager (filtered list), create_coupon (create + show manager), deactivate_coupon, list_coupons.
5. **Product catalog** — list_products, update_product, open_stripe_dashboard (interactive product catalog with inline editing).

## Guidelines

- **Be precise.** When the user asks about a specific campaign, use get_campaign_report, not list_campaigns. When they ask to compare, use compare_campaigns.
- **Scope sales.** If the user says "this month" or a date range, use open_sales_analytics with from/to. If they mention a product, pass product_id.
- **Scope coupons.** If the user asks about active coupons, use open_coupon_manager with active=true. If they want coupons for a specific product, pass product_id.
- **Prefer scoped tools.** Use open_sales_analytics over get_sales_report, open_coupon_manager over list_coupons, get_campaign_report over list_campaigns—unless the user explicitly wants the full overview.
- **Chain across domains.** If the user says "review Spring Launch results and create a coupon for it," chain get_campaign_report then create_coupon with campaign_id.
- When a tool renders a UI, mention the user can interact with it.
- Be concise. Reference actual data from tool results.
- Today's date is ${new Date().toISOString().slice(0, 10)}.`;

const parseJson = (value) => {
  try { return JSON.parse(value); }
  catch { return null; }
};

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const formatAppContexts = (appContexts) => {
  if (!Array.isArray(appContexts) || appContexts.length === 0) {
    return "";
  }

  return appContexts
    .map((entry, index) => {
      const label = normalizeText(entry?.source) || `App ${index + 1}`;
      const textBlocks = Array.isArray(entry?.content)
        ? entry.content
          .filter((block) => block?.type === "text" && typeof block?.text === "string")
          .map((block) => normalizeText(block.text))
          .filter(Boolean)
        : [];
      const structured = entry?.structuredContent && typeof entry.structuredContent === "object"
        ? JSON.stringify(entry.structuredContent, null, 2)
        : "";
      const parts = [
        textBlocks.join("\n"),
        structured ? `Structured:\n${structured}` : "",
      ].filter(Boolean);

      return parts.length > 0
        ? `## ${label}\n${parts.join("\n\n")}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
};

const toFunctionTool = (tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description ?? tool.title ?? tool.name,
  parameters: tool.inputSchema ?? { type: "object", properties: {} },
  strict: false,
});

const resultToOutput = (runtime, result) => {
  const structured = result?.structuredContent;
  if (structured && typeof structured === "object") return structured;
  return { text: runtime.extractText(result) || "Tool completed.", isError: result?.isError === true };
};

const toExecutionRecord = (tool, toolArgs, toolResult) => ({
  toolName: tool.name,
  toolTitle: tool.title ?? tool.name,
  toolDescription: tool.description ?? "",
  inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
  resourceUri: typeof tool?._meta?.ui?.resourceUri === "string" ? tool._meta.ui.resourceUri : null,
  toolArgs,
  toolResult,
});

const executeNamedTool = async (runtime, name, args = {}) => {
  const tool = runtime.getToolMetadata(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const toolResult = await runtime.callTool(name, args);
  return {
    text: runtime.extractText(toolResult) || "Tool completed.",
    execution: toExecutionRecord(tool, args, toolResult),
    toolOutput: resultToOutput(runtime, toolResult),
  };
};

const buildFallbackResponse = async (message, runtime) => {
  const lower = message.toLowerCase();

  const compareMatch = /compare\s+(.+?)\s+(?:vs\.?|versus|and|with)\s+(.+)/i.exec(message);
  if (compareMatch) {
    const { text, execution } = await executeNamedTool(runtime, "compare_campaigns", {
      left: compareMatch[1].trim(),
      right: compareMatch[2].trim(),
    });
    return { text, toolExecutions: [execution] };
  }

  const campaignMatch = /\b(?:show|get|open|report)\b.*\b(spring launch|feb(?:ruary)? (?:product )?update|january welcome)/i.exec(message);
  if (campaignMatch) {
    const { text, execution } = await executeNamedTool(runtime, "get_campaign_report", { campaign: campaignMatch[1] });
    return { text, toolExecutions: [execution] };
  }

  if (/\b(newsletter dashboard|all campaigns|campaign overview)\b/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_newsletter_dashboard", {});
    return { text, toolExecutions: [execution] };
  }

  if (/\b(campaign|newsletter|open rate|click rate|conversion)\b/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_newsletter_dashboard", {});
    return { text, toolExecutions: [execution] };
  }

  if (/\b(coupon manager|manage coupon|coupon list)\b/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_coupon_manager", {});
    return { text, toolExecutions: [execution] };
  }

  if (/\b(active coupon)/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_coupon_manager", { active: true });
    return { text, toolExecutions: [execution] };
  }

  if (/\b(coupon|discount|promo code|create.*code)\b/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_coupon_manager", {});
    return { text, toolExecutions: [execution] };
  }

  if (/\b(sales|revenue)\b/i.test(lower) && !/\b(product|pricing|plan)\b/i.test(lower)) {
    const args = {};
    const monthMatch = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.exec(lower);
    if (monthMatch) {
      const months = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
      const m = months[monthMatch[1].toLowerCase()];
      if (m) {
        const year = new Date().getFullYear();
        args.from = `${year}-${m}-01`;
        const lastDay = new Date(year, parseInt(m), 0).getDate();
        args.to = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
      }
    }
    if (/\bthis month\b/i.test(lower)) {
      const now = new Date();
      args.from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      args.to = now.toISOString().slice(0, 10);
    }
    const { text, execution } = await executeNamedTool(runtime, "open_sales_analytics", args);
    return { text, toolExecutions: [execution] };
  }

  if (/\b(product|pricing|starter|growth|plan|stripe)\b/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_stripe_dashboard", {});
    return { text, toolExecutions: [execution] };
  }

  const addMatch = /(?:add|create)\s+(?:a\s+)?todo[:\s]+(.+)/i.exec(message) ?? /^todo[:\s]+(.+)/i.exec(message);
  if (addMatch) {
    const { text, execution } = await executeNamedTool(runtime, "add_todo", { text: addMatch[1] });
    return { text, toolExecutions: [execution] };
  }

  const completeMatch = /(?:complete|finish|done|check off|mark done)\s+(.+)/i.exec(message);
  if (completeMatch) {
    const { text, execution } = await executeNamedTool(runtime, "complete_todo", { target: completeMatch[1] });
    return { text, toolExecutions: [execution] };
  }

  if (/\btodo/i.test(lower)) {
    const { text, execution } = await executeNamedTool(runtime, "open_todo_board", {});
    return { text, toolExecutions: [execution] };
  }

  return {
    text: "I can help with campaign reviews, sales analytics, coupon management, todos, or product catalog. Try asking about any of these.",
    toolExecutions: [],
  };
};

export const runAgentTurn = async ({ message, appContexts, runtime }) => {
  const prompt = String(message ?? "").replace(/\s+/g, " ").trim();
  const appContextBlock = formatAppContexts(appContexts);
  const promptWithContext = appContextBlock
    ? `${prompt}\n\nLatest live app context:\n${appContextBlock}`
    : prompt;

  if (!prompt) return { text: "Please type a message.", toolExecutions: [], mode: "local" };

  if (!hasAiAccess()) {
    const fallback = await buildFallbackResponse(prompt, runtime);
    return { ...fallback, mode: "local" };
  }

  const tools = await runtime.listModelTools();
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  let conversation = [{ role: "user", content: promptWithContext }];
  const toolExecutions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await complete({
      model: appConfig.model,
      input: conversation,
      tools: tools.map(toFunctionTool),
      instructions: AGENT_INSTRUCTIONS,
    });

    const calls = extractToolCalls(response.raw);

    if (calls.length === 0) {
      return { text: extractText(response.raw) || "Done.", toolExecutions, mode: "ai" };
    }

    const outputs = [];

    for (const call of calls) {
      const tool = toolMap.get(call.name);
      if (!tool) {
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: `Unknown tool: ${call.name}` }) });
        continue;
      }

      const toolArgs = parseJson(call.arguments) ?? {};
      const toolResult = await runtime.callTool(tool.name, toolArgs);
      toolExecutions.push(toExecutionRecord(tool, toolArgs, toolResult));
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(resultToOutput(runtime, toolResult)) });
    }

    conversation = [...conversation, ...response.output, ...outputs];
  }

  return { text: "Hit the tool limit for this turn, but the latest results are shown below.", toolExecutions, mode: "ai" };
};
