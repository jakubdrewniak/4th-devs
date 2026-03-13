import { createSession, createAgent, createItem, isFunctionCallOutput } from '../domain/index.js';
function createSessionRepo() {
    const store = new Map();
    return {
        async create(userId, title) {
            const session = createSession(crypto.randomUUID(), userId, title);
            store.set(session.id, session);
            return session;
        },
        async getById(id) {
            return store.get(id);
        },
        async update(session) {
            store.set(session.id, session);
            return session;
        },
    };
}
function createAgentRepo() {
    const store = new Map();
    return {
        async create(input) {
            const agent = createAgent(crypto.randomUUID(), input);
            store.set(agent.id, agent);
            return agent;
        },
        async getById(id) {
            return store.get(id);
        },
        async update(agent) {
            store.set(agent.id, agent);
            return agent;
        },
        async listBySession(sessionId) {
            return Array.from(store.values())
                .filter(a => a.sessionId === sessionId)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        },
        async listByParent(parentId) {
            return Array.from(store.values())
                .filter(a => a.parentId === parentId)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        },
        async findWaitingForCall(callId) {
            for (const agent of store.values()) {
                if (agent.status === 'waiting' && agent.waitingFor.some(w => w.callId === callId)) {
                    return agent;
                }
            }
            return undefined;
        },
    };
}
function createItemRepo() {
    const store = new Map();
    const sequences = new Map();
    function nextSeq(agentId) {
        const current = sequences.get(agentId) ?? 0;
        sequences.set(agentId, current + 1);
        return current + 1;
    }
    return {
        async create(agentId, input) {
            const item = createItem(crypto.randomUUID(), agentId, nextSeq(agentId), input);
            store.set(item.id, item);
            return item;
        },
        async getById(id) {
            return store.get(id);
        },
        async listByAgent(agentId) {
            return Array.from(store.values())
                .filter(i => i.agentId === agentId)
                .sort((a, b) => a.sequence - b.sequence);
        },
        async getOutputByCallId(callId) {
            for (const item of store.values()) {
                if (isFunctionCallOutput(item) && item.callId === callId) {
                    return item;
                }
            }
            return undefined;
        },
    };
}
export function createMemoryRepositories() {
    return {
        sessions: createSessionRepo(),
        agents: createAgentRepo(),
        items: createItemRepo(),
    };
}
