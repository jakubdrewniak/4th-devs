import * as readline from 'readline';
import { launch, saveSession, close, sessionExists } from './browser.js';
import { createBrowserTools, createMcpFileTools } from './tools/index.js';
import { createMcpClient } from './mcp.js';
import { runAgent } from './agent/index.js';
import { createFeedbackTracker } from './feedback/index.js';
import { log } from './log.js';

const mode = process.argv[2] ?? 'chat';

const loginFlow = async (): Promise<void> => {
  console.log('\n  Opening browser for manual login...');
  console.log('  1. Go to https://www.goodreads.com and log into your account.');
  console.log('  2. Once logged in, come back here and press Enter.\n');

  await launch({ headless: false });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) =>
    rl.question('  Press Enter when done logging in → ', () => {
      rl.close();
      resolve();
    }),
  );

  await saveSession();
  await close();

  console.log('\n  Session saved. You can now run: npm run lesson13:browser\n');
};

const chatFlow = async (): Promise<void> => {
  if (!sessionExists()) {
    console.log('');
    console.log('  ────────────────────────────────────────────────────────');
    console.log('  ⚠  Brak zapisanej sesji Goodreads.');
    console.log('');
    console.log('  Agent może przeglądać dowolne strony internetowe,');
    console.log('  ale aby korzystać z Goodreads, musisz się zalogować:');
    console.log('');
    console.log('    1. npm run lesson13:browser:login');
    console.log('    2. Przejdź do https://www.goodreads.com i zaloguj się');
    console.log('    3. Wróć do terminala i naciśnij Enter');
    console.log('  ────────────────────────────────────────────────────────');
    console.log('');
  }

  console.log('  Launching browser (headless)...');
  await launch({ headless: true });

  log.info('Connecting to files MCP...');
  const mcp = await createMcpClient('files');
  const mcpTools = await createMcpFileTools(mcp.client);
  log.info(`MCP tools loaded: ${Object.keys(mcpTools).join(', ')}`);

  const tools = { ...createBrowserTools(), ...mcpTools };
  const feedback = createFeedbackTracker();

  let lastResponseId: string | undefined;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n  You: ',
  });

  console.log('\n  Browser agent ready. Ask me anything about books on Goodreads.');
  console.log('  Example: "List all books by Jim Collins"');
  console.log('  Type "quit" to exit.\n');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
      console.log('\n  Goodbye!\n');
      await close();
      process.exit(0);
    }

    try {
      const result = await runAgent(input, tools, lastResponseId, feedback);
      lastResponseId = result.responseId;
      console.log(`\n  Agent: ${result.response}\n`);
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await mcp.close();
    await close();
    process.exit(0);
  });
};

const main = async (): Promise<void> => {
  switch (mode) {
    case 'login':
      await loginFlow();
      break;
    case 'chat':
      await chatFlow();
      break;
    default:
      console.log('Usage: bun src/index.ts [login|chat]');
      console.log('  login  — Open browser to log in and save session');
      console.log('  chat   — Start interactive chat with the browser agent');
      process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
