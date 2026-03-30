import * as readline from "node:readline";
import { run } from "./agent";
import { LazySandbox } from "./sandbox/client";
import { printWelcome } from "./welcome";

const isExitCommand = (input: string): boolean => {
  const normalized = input.trim().toLowerCase();
  return normalized === "exit" || normalized === "quit";
};

const main = async (): Promise<void> => {
  const sandbox = new LazySandbox();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n  You: ",
  });

  const runTurn = async (message: string): Promise<void> => {
    // Flush pending local edits before each turn.
    await sandbox.syncLocalVaultNow();

    try {
      const result = await run(message, { sandbox });
      console.log(`\n  Agent: ${result.text}\n`);
      console.log(`  [tokens: ${result.totalTokens}]`);
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      // Pull sandbox-produced vault updates so users see generated files quickly.
      await sandbox.syncVaultBackNow();
    }
  };

  rl.on("SIGINT", () => rl.close());

  printWelcome();
  rl.prompt();

  try {
    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }

      if (isExitCommand(input)) {
        rl.close();
        break;
      }

      await runTurn(input);
      rl.prompt();
    }
  } finally {
    await sandbox.destroy();
  }
};

await main();
