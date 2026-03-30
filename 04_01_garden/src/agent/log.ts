const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `${DIM}... (${text.length} chars)${RESET}`;
}

export function logToolCall(name: string, args: Record<string, unknown>): void {
  const argsStr = Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === "string" ? truncate(v, 80) : JSON.stringify(v);
      return `${k}=${val}`;
    })
    .join(" ");

  console.log(`${CYAN}→ ${name}${RESET} ${GRAY}${argsStr}${RESET}`);
}

export function logToolResult(name: string, output: string, ok: boolean): void {
  const color = ok ? GREEN : RED;
  const icon = ok ? "✓" : "✗";
  console.log(`${color}  ${icon} ${name}${RESET} ${GRAY}${truncate(output)}${RESET}`);
}

function logBuiltinToolCall(type: string, status: string, detail?: string): void {
  const color = status === "completed" ? GREEN : status === "failed" ? RED : CYAN;
  const icon = status === "completed" ? "✓" : status === "failed" ? "✗" : "→";
  const suffix = detail ? ` ${GRAY}${detail}${RESET}` : "";
  console.log(`${color}${icon} ${type}${RESET}${suffix}`);
}

interface WebSearchAction {
  type?: string;
  query?: string;
  queries?: string[];
  url?: string;
  pattern?: string;
  sources?: Array<{ url: string }>;
}

function logWebSearchAction(action: WebSearchAction): void {
  if (action.type === "search") {
    const queries = action.queries ?? (action.query ? [action.query] : []);
    if (queries.length > 0) {
      logBuiltinToolCall("web_search", "search", queries.map(q => `"${q}"`).join(", "));
    }
    if (action.sources?.length) {
      for (const source of action.sources) {
        logBuiltinToolCall("web_search", "source", source.url);
      }
    }
  } else if (action.type === "open_page" && action.url) {
    logBuiltinToolCall("web_search", "open_page", action.url);
  } else if (action.type === "find" && action.pattern) {
    logBuiltinToolCall("web_search", "find", `"${action.pattern}"`);
  }
}

export function logBuiltinTools(output: unknown[]): void {
  for (const item of output) {
    const it = item as { type?: string; status?: string; action?: WebSearchAction };
    if (it.type === "web_search_call" && it.action) {
      logWebSearchAction(it.action);
    }
  }
}

export function logTurn(turn: number): void {
  console.log(`\n${YELLOW}── turn ${turn} ──${RESET}`);
}
