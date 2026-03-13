/**
 * Runtime initialization
 */
import { createEventEmitter } from '../events/index.js';
import { createMemoryRepositories } from '../repositories/index.js';
import { createContext } from '../runtime/index.js';
import { registerProvider, createOpenAIProvider, createGeminiProvider, listProviders } from '../providers/index.js';
import { createToolRegistry } from '../tools/index.js';
import { config } from './config.js';
let runtime;
export function initRuntime() {
    if (runtime)
        return runtime;
    // Register providers
    if (config.openaiApiKey) {
        registerProvider(createOpenAIProvider({ apiKey: config.openaiApiKey }));
    }
    if (config.geminiApiKey) {
        registerProvider(createGeminiProvider({ apiKey: config.geminiApiKey }));
    }
    const providers = listProviders();
    if (providers.length === 0) {
        console.warn('No AI providers configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
    }
    else {
        console.log(`Providers: ${providers.join(', ')}`);
    }
    // Create tool registry (tools registered elsewhere)
    const tools = createToolRegistry();
    runtime = createContext(createEventEmitter(), createMemoryRepositories(), tools);
    return runtime;
}
export function getRuntime() {
    if (!runtime)
        throw new Error('Runtime not initialized');
    return runtime;
}
export function hasRuntime() {
    return runtime !== undefined;
}
