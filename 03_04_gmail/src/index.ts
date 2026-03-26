import * as readline from 'node:readline';
import { createSession, runAgent } from './agent/index.js';
import { MODEL } from './config.js';

const main = async (): Promise<void> => {
  const session = createSession();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n  You: ',
  });

  console.log('');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('  Gmail Agent — search, read, send, modify, attachment');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Wymagana autoryzacja Google OAuth:');
  console.log('    npm run lesson14:gmail:auth');
  console.log('');
  console.log('  Narzędzia: gmail_search, gmail_read, gmail_send,');
  console.log('             gmail_modify, gmail_attachment');
  console.log('');
  console.log('  Przykłady:');
  console.log('    Find my latest unread emails');
  console.log('    Read the last message from Anna');
  console.log('    Reply to the invoice thread saying "Got it, thanks"');
  console.log('');
  console.log('  Evals (Promptfoo, mocked):');
  console.log('    cd 03_04_gmail && bun run eval:tools');
  console.log('    cd 03_04_gmail && bun run eval:scenarios');
  console.log('    cd 03_04_gmail && bun run eval:all');
  console.log('');
  console.log('  Wpisz "exit" aby zakończyć.');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === 'exit' || input === 'quit') { process.exit(0); }

    try {
      const text = await runAgent({ model: MODEL, message: input, session });
      console.log(`\n  Agent: ${text}\n`);
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    rl.prompt();
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
