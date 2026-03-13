import { HTTPException } from 'hono/http-exception';
// Error factories - just functions, using Hono's HTTPException with cause
export const err = {
    validation: (message, details) => new HTTPException(400, { message, cause: details }),
    notFound: (message = 'Not found') => new HTTPException(404, { message }),
    unauthorized: (message = 'Unauthorized') => new HTTPException(401, { message }),
    forbidden: (message = 'Forbidden') => new HTTPException(403, { message }),
    rateLimited: (message = 'Too many requests') => new HTTPException(429, { message }),
    timeout: (message = 'Request timeout') => new HTTPException(408, { message }),
    payloadTooLarge: (message = 'Request too large') => new HTTPException(413, { message }),
    internal: (message = 'Internal server error') => new HTTPException(500, { message }),
};
// Error handler - formats HTTPException into envelope
export function errorHandler(error, ctx) {
    if (error instanceof HTTPException) {
        const apiError = error.cause
            ? { message: error.message, details: error.cause }
            : { message: error.message };
        return ctx.json({ data: null, error: apiError }, error.status);
    }
    console.error(`[${ctx.get('requestId') ?? 'no-id'}]`, error);
    return ctx.json({
        data: null,
        error: { message: 'Internal server error' },
    }, 500);
}
// 404 handler
export function notFoundHandler(ctx) {
    return ctx.json({ data: null, error: { message: 'Not found' } }, 404);
}
