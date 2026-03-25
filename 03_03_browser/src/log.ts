const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[37m';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ts = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const truncate = (s: string, max = 160): string =>
  s.length > max ? s.slice(0, max) + '...' : s;

const line = (prefix: string, color: string, msg: string) =>
  console.log(`  ${DIM}${ts()}${RESET} ${color}${prefix}${RESET} ${msg}`);

const separator = () =>
  console.log(`  ${DIM}${'─'.repeat(60)}${RESET}`);

export const log = {
  turn: (n: number, maxTurns: number) => {
    separator();
    line('TURN', `${BOLD}${WHITE}`, `${n}/${maxTurns}`);
  },

  thinking: () =>
    line('    ', DIM, 'thinking...'),

  toolCall: (name: string, args: Record<string, unknown>) => {
    const argsStr = truncate(JSON.stringify(args));
    line('CALL', CYAN, `${BOLD}${name}${RESET}${DIM}(${argsStr})${RESET}`);
  },

  toolOk: (name: string, result: string) =>
    line('  OK', GREEN, `${name} ${DIM}→ ${truncate(result)}${RESET}`),

  toolFail: (name: string, error: string) =>
    line('FAIL', RED, `${name} ${DIM}→ ${truncate(error)}${RESET}`),

  toolEmpty: (name: string) =>
    line('WARN', YELLOW, `${name} returned empty/null — selectors may be stale`),

  hint: (msg: string) =>
    line('HINT', MAGENTA, msg),

  tokens: (input: number, output: number, cached: number) =>
    line(' TOK', DIM, `in=${input} out=${output} cached=${cached}`),

  done: (turns: number, stats: { total: number; successes: number; failures: number }) => {
    separator();
    const failStr = stats.failures > 0 ? `${RED}${stats.failures} failed${RESET}` : `${GREEN}0 failed${RESET}`;
    line('DONE', `${BOLD}${GREEN}`, `${turns} turns | ${stats.total} tool calls (${stats.successes} ok, ${failStr}${BOLD}${GREEN})`);
  },

  totalTokens: (input: number, output: number, cached: number, total: number) =>
    line(' TOK', BLUE, `${BOLD}total${RESET}${BLUE} in=${input} out=${output} cached=${cached} sum=${total}${RESET}`),

  maxTurns: () =>
    line('STOP', `${BOLD}${RED}`, 'max turns reached'),

  error: (msg: string) =>
    line(' ERR', RED, msg),

  info: (msg: string) =>
    line('INFO', DIM, msg),
};
