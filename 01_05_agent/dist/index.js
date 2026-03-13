import { serve } from '@hono/node-server';
import { app } from './lib/app.js';
import { config } from './lib/config.js';
import { initRuntime } from './lib/runtime.js';
initRuntime();
const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
}, (info) => {
    console.log(`Server: http://${info.address}:${info.port}`);
});
const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
