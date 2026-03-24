import { runAgent } from './agent.js';
import * as log from './logger.js';

const main = async () => {
  const task =
    process.argv.slice(2).join(' ') ||
    'Triage both inboxes: read all unread emails, check the knowledge base for context, assign labels, and mark emails that need replies.';

  const result = await runAgent(task);
  log.result(result.response);
};

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
