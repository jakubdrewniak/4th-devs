import { llm } from './config.js';
import { emails } from './emails.js';
import { classifyEmail } from './classify.js';
import { logStart, logEmail, logDone } from './logger.js';

const main = async () => {
  logStart(emails.length);

  for (const email of emails) {
    const result = await classifyEmail(llm, email);
    logEmail(email, result);
  }

  logDone();
};

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
