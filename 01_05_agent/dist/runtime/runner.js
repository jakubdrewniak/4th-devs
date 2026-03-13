import { startAgent, completeAgent, failAgent, cancelAgent, incrementTurn, waitForMany, deliverOne, isMessage, isFunctionCall, isFunctionCallOutput } from '../domain/index.js';
import { createExecutionContext } from './context.js';
import { createEventContext } from '../events/index.js';
import { isAbortError, resolveProvider } from '../providers/index.js';
function makeCtx(exec, agent, batchId) {
    return createEventContext(exec.traceId, agent.sessionId, agent.id, exec.rootAgentId, exec.depth, exec.parentAgentId, batchId);
}
/** Map stored Items to provider input format */
function mapItemsToProviderInput(items) {
    const result = [];
    for (const item of items) {
        if (isMessage(item)) {
            result.push({
                type: 'message',
                role: item.role,
                content: item.content,
            });
        }
        else if (isFunctionCall(item)) {
            result.push({
                type: 'function_call',
                callId: item.callId,
                name: item.name,
                arguments: item.arguments,
            });
        }
        else if (isFunctionCallOutput(item)) {
            result.push({
                type: 'function_result',
                callId: item.callId,
                name: '', // Provider doesn't need name for results
                output: item.output,
            });
        }
        // Skip reasoning items for now
    }
    return result;
}
/** Store provider output as Items */
async function storeProviderOutput(agentId, output, runtime) {
    const stored = [];
    // Collect text parts for assistant message
    const textParts = output.filter(o => o.type === 'text');
    if (textParts.length > 0) {
        const content = textParts.map(t => t.text).join('');
        const item = await runtime.repositories.items.create(agentId, {
            type: 'message',
            role: 'assistant',
            content,
        });
        stored.push(item);
    }
    // Store function calls
    for (const o of output) {
        if (o.type === 'function_call') {
            const item = await runtime.repositories.items.create(agentId, {
                type: 'function_call',
                callId: o.callId,
                name: o.name,
                arguments: o.arguments,
            });
            stored.push(item);
        }
        else if (o.type === 'reasoning') {
            const item = await runtime.repositories.items.create(agentId, {
                type: 'reasoning',
                summary: o.text,
            });
            stored.push(item);
        }
    }
    return stored;
}
async function executeTurn(agent, runtime, exec, signal) {
    if (signal?.aborted) {
        return { continue: false, error: 'Operation aborted' };
    }
    // 1. Resolve provider from model string (e.g., "openai:gpt-5.2")
    const resolved = resolveProvider(agent.config.model);
    if (!resolved) {
        return { continue: false, error: `Unknown model or provider: ${agent.config.model}` };
    }
    const { provider, model } = resolved;
    // 2. Load items and map to provider format
    const items = await runtime.repositories.items.listByAgent(agent.id);
    const input = mapItemsToProviderInput(items);
    // 3. Call provider
    const response = await provider.generate({
        model,
        instructions: agent.task,
        input,
        tools: agent.config.tools,
        temperature: agent.config.temperature,
        maxTokens: agent.config.maxTokens,
        signal,
    });
    // 4. Store output items
    const outputItems = await storeProviderOutput(agent.id, response.output, runtime);
    // 5. Check for function calls
    const functionCalls = response.output.filter(o => o.type === 'function_call');
    if (functionCalls.length === 0) {
        // No function calls — agent is done
        const completeResult = completeAgent(agent, response.output);
        if (!completeResult.ok) {
            return { continue: false, error: completeResult.error };
        }
        return { continue: false, agent: completeResult.agent };
    }
    // 6. Process function calls
    const waitingFor = [];
    let hasSyncTools = false;
    for (const fc of functionCalls) {
        if (fc.type !== 'function_call')
            continue;
        const tool = runtime.tools.get(fc.name);
        if (!tool) {
            // No registered handler — treat as external tool, wait for result
            waitingFor.push({
                callId: fc.callId,
                type: 'tool',
                name: fc.name,
            });
            continue;
        }
        // Check tool type
        if (tool.type === 'sync') {
            // Execute synchronously
            const result = await runtime.tools.execute(fc.name, fc.arguments, signal);
            await runtime.repositories.items.create(agent.id, {
                type: 'function_call_output',
                callId: fc.callId,
                output: result.ok ? result.output : result.error,
                isError: !result.ok,
            });
            hasSyncTools = true;
        }
        else {
            // Async tool, agent spawn, or human confirmation — add to waiting list
            const waitType = tool.type === 'agent' ? 'agent'
                : tool.type === 'human' ? 'human'
                    : 'tool';
            waitingFor.push({
                callId: fc.callId,
                type: waitType,
                name: fc.name,
                description: tool.definition.description,
            });
        }
    }
    // 7. Return based on what we found
    if (waitingFor.length > 0) {
        // Need to wait for async results
        return { continue: false, waiting: waitingFor, agent };
    }
    if (hasSyncTools) {
        // Had sync tools — continue to next turn
        return { continue: true, agent };
    }
    // Shouldn't reach here, but just in case
    return { continue: true, agent };
}
export async function runAgent(agentId, runtime, options = {}) {
    const { maxTurns = 10, signal } = options;
    if (signal?.aborted) {
        return { ok: false, status: 'cancelled' };
    }
    let agent = await runtime.repositories.agents.getById(agentId);
    if (!agent) {
        return { ok: false, status: 'failed', error: `Agent not found: ${agentId}` };
    }
    // Create execution context
    const exec = options.execution ?? createExecutionContext(crypto.randomUUID(), agent.rootAgentId, agent.parentId, agent.depth);
    // Start agent if pending
    if (agent.status === 'pending') {
        const startResult = startAgent(agent);
        if (!startResult.ok) {
            return { ok: false, status: 'failed', error: startResult.error };
        }
        agent = await runtime.repositories.agents.update(startResult.agent);
        runtime.events.emit({
            type: 'agent.started',
            ctx: makeCtx(exec, agent),
            model: agent.config.model,
            task: agent.task,
        });
    }
    // If already waiting, just return current state
    if (agent.status === 'waiting') {
        return { ok: true, status: 'waiting', agent, waitingFor: agent.waitingFor };
    }
    try {
        while (agent.status === 'running' && agent.turnCount < maxTurns) {
            if (signal?.aborted) {
                agent = cancelAgent(agent);
                await runtime.repositories.agents.update(agent);
                runtime.events.emit({ type: 'agent.cancelled', ctx: makeCtx(exec, agent) });
                return { ok: false, status: 'cancelled' };
            }
            runtime.events.emit({
                type: 'turn.started',
                ctx: makeCtx(exec, agent),
                turnCount: agent.turnCount,
            });
            const turnResult = await executeTurn(agent, runtime, exec, signal);
            // Handle error
            if ('error' in turnResult) {
                agent = failAgent(agent, turnResult.error);
                await runtime.repositories.agents.update(agent);
                runtime.events.emit({
                    type: 'agent.failed',
                    ctx: makeCtx(exec, agent),
                    error: turnResult.error,
                });
                return { ok: false, status: 'failed', error: turnResult.error };
            }
            agent = incrementTurn(turnResult.agent);
            await runtime.repositories.agents.update(agent);
            runtime.events.emit({
                type: 'turn.completed',
                ctx: makeCtx(exec, agent),
                turnCount: agent.turnCount,
            });
            // Handle waiting (non-blocking return)
            if ('waiting' in turnResult) {
                const waitResult = waitForMany(agent, turnResult.waiting);
                if (!waitResult.ok) {
                    return { ok: false, status: 'failed', error: waitResult.error };
                }
                agent = await runtime.repositories.agents.update(waitResult.agent);
                runtime.events.emit({
                    type: 'agent.waiting',
                    ctx: makeCtx(exec, agent),
                    waitingFor: turnResult.waiting,
                });
                return { ok: true, status: 'waiting', agent, waitingFor: turnResult.waiting };
            }
            // Continue or done
            if (!turnResult.continue) {
                break;
            }
        }
        // Completed
        const durationMs = agent.startedAt
            ? Date.now() - agent.startedAt.getTime()
            : 0;
        runtime.events.emit({
            type: 'agent.completed',
            ctx: makeCtx(exec, agent),
            durationMs,
        });
        const items = await runtime.repositories.items.listByAgent(agentId);
        return { ok: true, status: 'completed', agent, items };
    }
    catch (err) {
        if (isAbortError(err)) {
            agent = cancelAgent(agent);
            await runtime.repositories.agents.update(agent);
            runtime.events.emit({ type: 'agent.cancelled', ctx: makeCtx(exec, agent) });
            return { ok: false, status: 'cancelled' };
        }
        throw err;
    }
}
/**
 * Deliver a result to a waiting agent
 */
export async function deliverResult(agentId, callId, result, runtime, execution) {
    let agent = await runtime.repositories.agents.getById(agentId);
    if (!agent) {
        return { ok: false, status: 'failed', error: `Agent not found: ${agentId}` };
    }
    if (agent.status !== 'waiting') {
        return { ok: false, status: 'failed', error: `Agent not waiting: ${agent.status}` };
    }
    // Add result as function_call_output
    await runtime.repositories.items.create(agent.id, {
        type: 'function_call_output',
        callId,
        output: result.ok ? result.output : result.error,
        isError: !result.ok,
    });
    // Remove from waiting list
    const deliverRes = deliverOne(agent, callId);
    if (!deliverRes.ok) {
        return { ok: false, status: 'failed', error: deliverRes.error };
    }
    agent = await runtime.repositories.agents.update(deliverRes.agent);
    const exec = execution ?? createExecutionContext(crypto.randomUUID(), agent.rootAgentId, agent.parentId, agent.depth);
    runtime.events.emit({
        type: 'agent.resumed',
        ctx: makeCtx(exec, agent),
        deliveredCallId: callId,
        remaining: agent.waitingFor.length,
    });
    // If still waiting, return
    if (agent.waitingFor.length > 0) {
        return { ok: true, status: 'waiting', agent, waitingFor: agent.waitingFor };
    }
    // All delivered, continue execution
    return runAgent(agentId, runtime, { execution: exec });
}
/**
 * Stream a single turn — yields events as they come from provider
 */
async function* executeTurnStream(agent, runtime, exec, signal) {
    if (signal?.aborted) {
        return { continue: false, error: 'Operation aborted' };
    }
    // 1. Resolve provider
    const resolved = resolveProvider(agent.config.model);
    if (!resolved) {
        return { continue: false, error: `Unknown model or provider: ${agent.config.model}` };
    }
    const { provider, model } = resolved;
    // 2. Load items and map to provider format
    const items = await runtime.repositories.items.listByAgent(agent.id);
    const input = mapItemsToProviderInput(items);
    // 3. Stream from provider
    let response;
    for await (const event of provider.stream({
        model,
        instructions: agent.task,
        input,
        tools: agent.config.tools,
        temperature: agent.config.temperature,
        maxTokens: agent.config.maxTokens,
        signal,
    })) {
        // Forward all events
        yield event;
        // Capture final response
        if (event.type === 'done') {
            response = event.response;
        }
        // Early exit on error
        if (event.type === 'error') {
            return { continue: false, error: event.error };
        }
    }
    if (!response) {
        return { continue: false, error: 'Stream ended without response' };
    }
    // 4. Store output items
    await storeProviderOutput(agent.id, response.output, runtime);
    // 5. Check for function calls
    const functionCalls = response.output.filter(o => o.type === 'function_call');
    if (functionCalls.length === 0) {
        const completeResult = completeAgent(agent, response.output);
        if (!completeResult.ok) {
            return { continue: false, error: completeResult.error };
        }
        return { continue: false, agent: completeResult.agent };
    }
    // 6. Process function calls (same logic as executeTurn)
    const waitingFor = [];
    let hasSyncTools = false;
    for (const fc of functionCalls) {
        if (fc.type !== 'function_call')
            continue;
        const tool = runtime.tools.get(fc.name);
        if (!tool) {
            waitingFor.push({ callId: fc.callId, type: 'tool', name: fc.name });
            continue;
        }
        if (tool.type === 'sync') {
            const result = await runtime.tools.execute(fc.name, fc.arguments, signal);
            await runtime.repositories.items.create(agent.id, {
                type: 'function_call_output',
                callId: fc.callId,
                output: result.ok ? result.output : result.error,
                isError: !result.ok,
            });
            hasSyncTools = true;
        }
        else {
            const waitType = tool.type === 'agent' ? 'agent'
                : tool.type === 'human' ? 'human'
                    : 'tool';
            waitingFor.push({
                callId: fc.callId,
                type: waitType,
                name: fc.name,
                description: tool.definition.description,
            });
        }
    }
    if (waitingFor.length > 0) {
        return { continue: false, waiting: waitingFor, agent };
    }
    if (hasSyncTools) {
        return { continue: true, agent };
    }
    return { continue: true, agent };
}
export async function* runAgentStream(agentId, runtime, options = {}) {
    const { maxTurns = 10, signal } = options;
    if (signal?.aborted) {
        yield { type: 'error', error: 'Operation aborted', code: 'ABORTED' };
        return;
    }
    let agent = await runtime.repositories.agents.getById(agentId);
    if (!agent) {
        yield { type: 'error', error: `Agent not found: ${agentId}` };
        return;
    }
    const exec = options.execution ?? createExecutionContext(crypto.randomUUID(), agent.rootAgentId, agent.parentId, agent.depth);
    try {
        // Start agent
        const startResult = startAgent(agent);
        if (!startResult.ok) {
            yield { type: 'error', error: startResult.error };
            return;
        }
        agent = await runtime.repositories.agents.update(startResult.agent);
        runtime.events.emit({
            type: 'agent.started',
            ctx: makeCtx(exec, agent),
            model: agent.config.model,
            task: agent.task,
        });
        // Turn loop
        for (let turn = 0; turn < maxTurns; turn++) {
            runtime.events.emit({
                type: 'turn.started',
                ctx: makeCtx(exec, agent),
                turnCount: turn + 1,
            });
            // Stream the turn
            const turnGen = executeTurnStream(agent, runtime, exec, signal);
            let turnResult;
            // Yield events and get final result
            while (true) {
                const { value, done } = await turnGen.next();
                if (done) {
                    turnResult = value;
                    break;
                }
                yield value;
            }
            if (!turnResult) {
                yield { type: 'error', error: 'Turn ended without result' };
                return;
            }
            if ('error' in turnResult) {
                yield { type: 'error', error: turnResult.error };
                return;
            }
            // Update agent
            agent = incrementTurn(turnResult.agent);
            await runtime.repositories.agents.update(agent);
            runtime.events.emit({
                type: 'turn.completed',
                ctx: makeCtx(exec, agent),
                turnCount: agent.turnCount,
            });
            // Handle waiting
            if ('waiting' in turnResult) {
                const waitResult = waitForMany(agent, turnResult.waiting);
                if (!waitResult.ok) {
                    yield { type: 'error', error: waitResult.error };
                    return;
                }
                agent = await runtime.repositories.agents.update(waitResult.agent);
                runtime.events.emit({
                    type: 'agent.waiting',
                    ctx: makeCtx(exec, agent),
                    waitingFor: turnResult.waiting,
                });
                // Stream ends here when waiting - caller handles resume
                return;
            }
            if (!turnResult.continue) {
                break;
            }
        }
        // Completed
        runtime.events.emit({
            type: 'agent.completed',
            ctx: makeCtx(exec, agent),
            durationMs: agent.startedAt ? Date.now() - agent.startedAt.getTime() : 0,
        });
    }
    catch (err) {
        if (isAbortError(err)) {
            agent = cancelAgent(agent);
            await runtime.repositories.agents.update(agent);
            runtime.events.emit({ type: 'agent.cancelled', ctx: makeCtx(exec, agent) });
            yield { type: 'error', error: 'Operation cancelled', code: 'CANCELLED' };
            return;
        }
        throw err;
    }
}
