import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { chatRequestSchema, deliverRequestSchema } from './chat.schema.js';
import { processChat, processChatStream, deliverResult } from './chat.service.js';
const chat = new Hono();
// Create chat completion
chat.post('/completions', zValidator('json', chatRequestSchema, (result, c) => {
    if (!result.success) {
        return c.json({
            data: null,
            error: { message: 'Validation failed', details: result.error.issues },
        }, 400);
    }
}), async (c) => {
    const req = c.req.valid('json');
    const runtime = c.get('runtime');
    if (!runtime) {
        return c.json({ data: null, error: { message: 'Runtime not initialized' } }, 500);
    }
    if (req.stream) {
        return streamSSE(c, async (stream) => {
            for await (const event of processChatStream(req, runtime)) {
                await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
            }
        });
    }
    const result = await processChat(req, runtime);
    if (!result.ok) {
        return c.json({ data: null, error: { message: result.error } }, 500);
    }
    // Return 202 if waiting, 200 if completed
    const status = result.response.status === 'waiting' ? 202 : 200;
    return c.json({ data: result.response, error: null }, status);
});
// Deliver result to waiting agent
chat.post('/agents/:agentId/deliver', zValidator('json', deliverRequestSchema, (result, c) => {
    if (!result.success) {
        return c.json({
            data: null,
            error: { message: 'Validation failed', details: result.error.issues },
        }, 400);
    }
}), async (c) => {
    const { agentId } = c.req.param();
    const req = c.req.valid('json');
    const runtime = c.get('runtime');
    if (!runtime) {
        return c.json({ data: null, error: { message: 'Runtime not initialized' } }, 500);
    }
    const toolResult = req.isError
        ? { ok: false, error: req.output }
        : { ok: true, output: req.output };
    const result = await deliverResult(agentId, req.callId, toolResult, runtime);
    if (!result.ok) {
        return c.json({ data: null, error: { message: result.error } }, 400);
    }
    const status = result.response.status === 'waiting' ? 202 : 200;
    return c.json({ data: result.response, error: null }, status);
});
// Get agent status
chat.get('/agents/:agentId', async (c) => {
    const { agentId } = c.req.param();
    const runtime = c.get('runtime');
    if (!runtime) {
        return c.json({ data: null, error: { message: 'Runtime not initialized' } }, 500);
    }
    const agent = await runtime.repositories.agents.getById(agentId);
    if (!agent) {
        return c.json({ data: null, error: { message: 'Agent not found' } }, 404);
    }
    return c.json({
        data: {
            id: agent.id,
            sessionId: agent.sessionId,
            status: agent.status,
            waitingFor: agent.waitingFor,
            turnCount: agent.turnCount,
            depth: agent.depth,
            parentId: agent.parentId,
            rootAgentId: agent.rootAgentId,
        },
        error: null,
    });
});
export { chat };
