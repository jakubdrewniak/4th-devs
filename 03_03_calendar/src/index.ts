import { resolveModelForProvider } from '../../config.js';
import { runAgent } from './agent.js';

const MODEL = resolveModelForProvider(process.env.MODEL ?? 'gpt-5.2');

const main = async (): Promise<void> => {
  await runAgent(MODEL);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Fatal:', message);
  process.exit(1);
});
