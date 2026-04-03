import { startServer } from "./src/server.js";

const main = async () => {
  const server = await startServer();
  console.log(`04_05_apps running at ${server.url}`);
};

main().catch((error) => {
  console.error("Failed to start 04_05_apps.");
  console.error(error);
  process.exitCode = 1;
});
