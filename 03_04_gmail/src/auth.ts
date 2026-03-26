import { authenticateGmail } from './gmail/auth.js';

const main = async (): Promise<void> => {
  const result = await authenticateGmail();
  console.log(`OAuth completed. Token saved to ${result.tokenPath}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Auth failed: ${message}`);
  process.exit(1);
});
