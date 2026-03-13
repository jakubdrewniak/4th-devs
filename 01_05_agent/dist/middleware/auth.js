import { createMiddleware } from 'hono/factory';
import { config } from '../lib/config.js';
import { err } from '../errors/index.js';
/**
 * Bearer token authentication middleware.
 * Validates Authorization header against configured token.
 */
export const bearerAuth = createMiddleware(async (ctx, next) => {
    const authHeader = ctx.req.header('Authorization');
    if (!authHeader) {
        throw err.unauthorized('Missing Authorization header');
    }
    if (!authHeader.startsWith('Bearer ')) {
        throw err.unauthorized('Invalid Authorization format. Expected: Bearer <token>');
    }
    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    if (!token) {
        throw err.unauthorized('Missing token');
    }
    // Constant-time comparison to prevent timing attacks
    if (!timingSafeEqual(token, config.authToken)) {
        throw err.unauthorized('Invalid token');
    }
    await next();
});
/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(provided, expected) {
    let compare = expected;
    if (provided.length !== expected.length) {
        // Still do comparison to maintain constant time
        compare = provided;
    }
    let result = 0;
    for (let index = 0; index < provided.length; index++) {
        result |= provided.charCodeAt(index) ^ compare.charCodeAt(index);
    }
    return result === 0 && provided.length === expected.length;
}
