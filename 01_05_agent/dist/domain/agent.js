export function createAgent(id, input) {
    return {
        id,
        sessionId: input.sessionId,
        rootAgentId: input.rootAgentId ?? id,
        parentId: input.parentId,
        sourceCallId: input.sourceCallId,
        depth: input.depth ?? 0,
        task: input.task,
        config: input.config,
        status: 'pending',
        waitingFor: [],
        turnCount: 0,
        createdAt: new Date(),
    };
}
export function startAgent(agent) {
    if (agent.status !== 'pending') {
        return { ok: false, error: `Cannot start agent in status: ${agent.status}` };
    }
    return {
        ok: true,
        agent: { ...agent, status: 'running', startedAt: new Date() },
    };
}
export function waitForMany(agent, waiting) {
    if (agent.status !== 'running') {
        return { ok: false, error: `Cannot wait agent in status: ${agent.status}` };
    }
    return {
        ok: true,
        agent: { ...agent, status: 'waiting', waitingFor: waiting },
    };
}
export function deliverOne(agent, callId) {
    if (agent.status !== 'waiting') {
        return { ok: false, error: `Cannot deliver to agent in status: ${agent.status}` };
    }
    const remaining = agent.waitingFor.filter(w => w.callId !== callId);
    if (remaining.length === agent.waitingFor.length) {
        return { ok: false, error: `Agent not waiting for callId: ${callId}` };
    }
    // If all delivered, transition to running
    const newStatus = remaining.length === 0 ? 'running' : 'waiting';
    return {
        ok: true,
        agent: { ...agent, status: newStatus, waitingFor: remaining },
    };
}
export function isWaitComplete(agent) {
    return agent.status === 'waiting' && agent.waitingFor.length === 0;
}
export function completeAgent(agent, result) {
    if (agent.status !== 'running') {
        return { ok: false, error: `Cannot complete agent in status: ${agent.status}` };
    }
    return {
        ok: true,
        agent: { ...agent, status: 'completed', result, completedAt: new Date() },
    };
}
export function failAgent(agent, error) {
    return { ...agent, status: 'failed', error, completedAt: new Date() };
}
export function cancelAgent(agent) {
    return { ...agent, status: 'cancelled', completedAt: new Date() };
}
export function incrementTurn(agent) {
    return { ...agent, turnCount: agent.turnCount + 1 };
}
