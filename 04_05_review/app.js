import { maybeOpenBrowser } from "./src/browser.js";
import { startServer } from "./src/server.js";

const { port } = await startServer();
const url = `http://127.0.0.1:${port}`;

console.log(`04_05_review running at ${url}`);

await maybeOpenBrowser(url);
