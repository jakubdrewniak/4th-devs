const env = process.env;
function requireEnv(key) {
    const value = env[key];
    if (!value) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
    return value;
}
function optionalEnv(key) {
    return env[key];
}
export const config = {
    port: parseInt(env.PORT || '3000', 10),
    host: env.HOST || '127.0.0.1',
    // Auth (required)
    authToken: requireEnv('AUTH_TOKEN'),
    // Request limits
    bodyLimit: parseInt(env.BODY_LIMIT || String(1024 * 1024), 10), // 1MB default
    timeoutMs: parseInt(env.TIMEOUT_MS || '60000', 10), // 60s default
    // CORS - comma-separated origins or '*' for dev
    corsOrigin: env.CORS_ORIGIN || '*',
    // Provider API keys (at least one required for AI features)
    openaiApiKey: optionalEnv('OPENAI_API_KEY'),
    geminiApiKey: optionalEnv('GEMINI_API_KEY'),
    // Default model (format: "provider:model")
    defaultModel: env.DEFAULT_MODEL || 'openai:gpt-4.1',
    // Agent defaults
    agentMaxTurns: parseInt(env.AGENT_MAX_TURNS || '10', 10),
};
