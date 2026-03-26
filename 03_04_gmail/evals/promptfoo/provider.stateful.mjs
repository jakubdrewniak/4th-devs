import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(CURRENT_DIR, '..', '..');
const DEFAULT_SESSION_DIR = resolve(PROJECT_ROOT, 'evals', 'promptfoo', '.sessions');

const toSafeInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const getOptionValue = (options, key) =>
  options?.[key] ?? options?.config?.[key];

const resolveInstructions = (context, options) =>
  String(
    context?.vars?.instructions
    || context?.vars?.eval_instructions
    || getOptionValue(options, 'instructions')
    || process.env.EVAL_SYSTEM_PROMPT
    || '',
  ).trim();

const runEvalCli = (args) =>
  new Promise((resolvePromise) => {
    const child = spawn('bun', args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      resolvePromise({
        status: 1,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (code) => {
      resolvePromise({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

const resolveSessionDir = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_SESSION_DIR;
  }
  return value.startsWith('/') ? value : resolve(PROJECT_ROOT, value);
};

const resolveConversationId = (context) =>
  String(
    context?.test?.metadata?.conversationId
    || context?.vars?.conversation_id
    || context?.vars?.conversationId
    || '',
  ).trim();

const resolveSessionKey = (context, model) => {
  const conversationId = resolveConversationId(context);
  if (!conversationId) return '';

  const evaluationId = String(context?.evaluationId ?? 'eval').trim() || 'eval';
  return `${evaluationId}:${conversationId}:${model}`;
};

export default class GmailAgentStatefulProvider {
  constructor(options = {}) {
    this.options = options;
    this.sessionChains = new Map();
  }

  runInSessionOrder(sessionKey, task) {
    if (!sessionKey) return task();

    const previous = this.sessionChains.get(sessionKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tracked = next.finally(() => {
      if (this.sessionChains.get(sessionKey) === tracked) {
        this.sessionChains.delete(sessionKey);
      }
    });

    this.sessionChains.set(sessionKey, tracked);
    return tracked;
  }

  id() {
    const model =
      getOptionValue(this.options, 'model') ||
      process.env.EVAL_MODEL ||
      process.env.MODEL ||
      'gpt-5.2';
    return `gmail-agent-stateful:${model}`;
  }

  async callApi(prompt, context) {
    const model =
      context?.vars?.model ||
      getOptionValue(this.options, 'model') ||
      process.env.EVAL_MODEL ||
      process.env.MODEL ||
      'gpt-5.2';

    const maxTurns = toSafeInt(
      context?.vars?.max_turns ?? getOptionValue(this.options, 'maxTurns') ?? 8,
      8,
      1,
      24,
    );
    const instructions = resolveInstructions(context, this.options);

    const sessionDir = resolveSessionDir(
      context?.vars?.session_dir ?? getOptionValue(this.options, 'sessionDir'),
    );
    const sessionKey = resolveSessionKey(context, model);

    const args = [
      'src/evals/run-agent-eval.ts',
      '--model',
      String(model),
      '--max-turns',
      String(maxTurns),
      '--message',
      String(prompt),
    ];

    if (instructions) {
      args.push('--instructions', instructions);
    }

    if (sessionKey) {
      args.push('--session-key', sessionKey, '--session-dir', sessionDir);
    }

    const execute = async () => {
      const result = await runEvalCli(args);

      if (result.status !== 0) {
        const error = result.stderr.trim() || `Runner exited with status ${result.status}`;
        return {
          error,
          output: JSON.stringify({ error }),
        };
      }

      const output = result.stdout.trim();
      try {
        JSON.parse(output);
      } catch {
        const error = 'Invalid JSON output from eval runner';
        return {
          error,
          output: JSON.stringify({ error, raw: output.slice(0, 1000) }),
        };
      }

      return { output };
    };

    return this.runInSessionOrder(sessionKey, execute);
  }
}
