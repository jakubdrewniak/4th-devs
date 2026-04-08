import { AxAI } from '@ax-llm/ax';
import { AI_API_KEY, AI_PROVIDER } from '../../config.js';

const MODEL = 'gpt-4.1-mini';

export const llm = new AxAI({
  name: AI_PROVIDER as 'openai' | 'openrouter',
  apiKey: AI_API_KEY,
  config: {
    model: AI_PROVIDER === 'openrouter' ? `openai/${MODEL}` : MODEL,
  },
});
