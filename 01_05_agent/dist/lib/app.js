import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { timeout } from 'hono/timeout';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { createMiddleware } from 'hono/factory';
import { config } from './config.js';
import { getRuntime, hasRuntime } from './runtime.js';
import { errorHandler, notFoundHandler, err } from '../errors/index.js';
import { bearerAuth } from '../middleware/index.js';
import { routes } from '../routes/index.js';
export const app = new Hono();
app.use(requestId());
app.use(logger());
app.use(secureHeaders());
app.use(cors({
    origin: config.corsOrigin === '*'
        ? '*'
        : config.corsOrigin.split(',').map(o => o.trim()),
}));
app.use('/api/*', bodyLimit({
    maxSize: config.bodyLimit,
    onError: () => { throw err.payloadTooLarge(); },
}));
app.use('/api/*', timeout(config.timeoutMs));
app.use('/api/*', bearerAuth);
// Inject runtime
app.use('/api/*', createMiddleware(async (c, next) => {
    if (hasRuntime()) {
        c.set('runtime', getRuntime());
    }
    await next();
}));
app.onError(errorHandler);
app.notFound(notFoundHandler);
app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api', routes);
