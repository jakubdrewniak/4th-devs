import type {
  GetPromptResult,
  PromptMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { GreetingPromptArgs } from '../schemas/prompts.js';
import { logger } from '../utils/logger.js';

const greetings = {
  en: 'Hello',
  es: 'Hola',
  fr: 'Bonjour',
  de: 'Hallo',
};

export const greetingPrompt = {
  name: 'greeting',
  description: 'Generate a personalized greeting in multiple languages',

  handler: async (args: unknown): Promise<GetPromptResult> => {
    logger.debug('greeting_prompt', { message: 'Greeting prompt called', args });

    const validation = GreetingPromptArgs.safeParse(args);
    if (!validation.success) {
      throw new Error(`Invalid arguments: ${validation.error.message}`);
    }

    const { name, language } = validation.data;
    const greeting = greetings[language];

    const messages: PromptMessage[] = [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a warm, personalized greeting for ${name}. Start with "${greeting}, ${name}!" and then add a friendly welcome message that makes them feel valued and appreciated. Keep it concise but heartfelt.`,
        },
      },
    ];

    logger.info('greeting_prompt', {
      message: 'Greeting prompt generated',
      name,
      language,
    });

    return { messages };
  },
};
