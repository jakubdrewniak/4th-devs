const providers = new Map();
export function registerProvider(provider) {
    providers.set(provider.name, provider);
}
export function getProvider(name) {
    return providers.get(name);
}
export function listProviders() {
    return Array.from(providers.keys());
}
/** Parse "openai:gpt-4.1" -> { provider: "openai", model: "gpt-4.1" } */
export function parseModelString(modelString) {
    const idx = modelString.indexOf(':');
    if (idx === -1)
        return undefined;
    return {
        providerName: modelString.slice(0, idx),
        model: modelString.slice(idx + 1),
    };
}
/** Resolve model string to provider instance */
export function resolveProvider(modelString) {
    const parsed = parseModelString(modelString);
    if (!parsed)
        return undefined;
    const provider = providers.get(parsed.providerName);
    if (!provider)
        return undefined;
    return { provider, model: parsed.model };
}
