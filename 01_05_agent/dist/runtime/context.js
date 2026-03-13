export function createContext(events, repositories, tools) {
    return { events, repositories, tools };
}
export function createExecutionContext(traceId, rootAgentId, parentAgentId, depth = 0) {
    return { traceId, rootAgentId, parentAgentId, depth };
}
