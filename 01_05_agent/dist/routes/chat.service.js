import { runAgent, runAgentStream, deliverResult as deliverAgentResult } from '../runtime/index.js';
function mapToResponse(agent, items, status, waitingFor) {
    const output = [];
    for (const item of items) {
        if (item.type === 'message' && item.role === 'assistant') {
            const text = typeof item.content === 'string'
                ? item.content
                : item.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('');
            if (text)
                output.push({ type: 'text', text });
        }
        else if (item.type === 'function_call') {
            output.push({ type: 'function_call', callId: item.callId, name: item.name, arguments: item.arguments });
        }
    }
    return {
        id: agent.id,
        sessionId: agent.sessionId,
        status,
        model: agent.config.model,
        output,
        waitingFor,
    };
}
// Convert request content to domain Content type
function toContent(content) {
    if (typeof content === 'string')
        return content;
    return content;
}
export async function processChat(req, ctx) {
    const model = req.model ?? 'openai:gpt-4.1';
    const traceId = crypto.randomUUID();
    // Get or create session
    const session = req.sessionId
        ? await ctx.repositories.sessions.getById(req.sessionId) ?? await ctx.repositories.sessions.create()
        : await ctx.repositories.sessions.create();
    // Create agent (root agent, depth 0)
    const agent = await ctx.repositories.agents.create({
        sessionId: session.id,
        task: req.instructions ?? 'You are a helpful assistant.',
        config: { model, temperature: req.temperature, maxTokens: req.maxTokens, tools: req.tools },
    });
    // Add input items
    const input = typeof req.input === 'string'
        ? [{ type: 'message', role: 'user', content: req.input }]
        : req.input;
    for (const item of input) {
        if (item.type === 'message') {
            await ctx.repositories.items.create(agent.id, {
                type: 'message',
                role: item.role,
                content: toContent(item.content),
            });
        }
    }
    // Run agent with execution context
    const result = await runAgent(agent.id, ctx, {
        maxTurns: 10,
        execution: {
            traceId,
            rootAgentId: agent.id,
            depth: 0,
        },
    });
    if (!result.ok) {
        return { ok: false, error: result.status === 'cancelled' ? 'Cancelled' : result.error };
    }
    const items = result.status === 'completed'
        ? result.items
        : await ctx.repositories.items.listByAgent(agent.id);
    return {
        ok: true,
        response: mapToResponse(result.agent, items, result.status, result.status === 'waiting' ? result.waitingFor : undefined)
    };
}
export async function deliverResult(agentId, callId, result, ctx) {
    const runResult = await deliverAgentResult(agentId, callId, result, ctx);
    if (!runResult.ok) {
        return { ok: false, error: runResult.status === 'cancelled' ? 'Cancelled' : runResult.error };
    }
    const items = runResult.status === 'completed'
        ? runResult.items
        : await ctx.repositories.items.listByAgent(agentId);
    return {
        ok: true,
        response: mapToResponse(runResult.agent, items, runResult.status, runResult.status === 'waiting' ? runResult.waitingFor : undefined)
    };
}
export async function* processChatStream(req, ctx) {
    const model = req.model ?? 'openai:gpt-4.1';
    const traceId = crypto.randomUUID();
    // Get or create session
    const session = req.sessionId
        ? await ctx.repositories.sessions.getById(req.sessionId) ?? await ctx.repositories.sessions.create()
        : await ctx.repositories.sessions.create();
    // Create agent
    const agent = await ctx.repositories.agents.create({
        sessionId: session.id,
        task: req.instructions ?? 'You are a helpful assistant.',
        config: { model, temperature: req.temperature, maxTokens: req.maxTokens, tools: req.tools },
    });
    // Add input items
    const input = typeof req.input === 'string'
        ? [{ type: 'message', role: 'user', content: req.input }]
        : req.input;
    for (const item of input) {
        if (item.type === 'message') {
            await ctx.repositories.items.create(agent.id, {
                type: 'message',
                role: item.role,
                content: toContent(item.content),
            });
        }
    }
    // Stream agent execution
    yield* runAgentStream(agent.id, ctx, {
        maxTurns: 10,
        execution: {
            traceId,
            rootAgentId: agent.id,
            depth: 0,
        },
    });
}
