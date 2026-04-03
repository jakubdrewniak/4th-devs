import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLowLevelServer } from '../mcp/server-internals.js';
import { logger } from '../utils/logger.js';
import { paginateArray } from '../utils/pagination.js';
import { analysisPrompt } from './analysis.prompt.js';
import { greetingPrompt } from './greeting.prompt.js';
import { multimodalPrompt } from './multimodal.prompt.js';

const prompts = [greetingPrompt, analysisPrompt, multimodalPrompt];

export function registerPrompts(server: McpServer): void {
  // Register each prompt with argument schemas for better introspection
  server.registerPrompt(
    greetingPrompt.name,
    {
      title: 'Greeting Prompt',
      description: greetingPrompt.description,
      argsSchema: {
        name: z.string().describe('Name to greet'),
        language: z.enum(['en', 'es', 'fr', 'de']).optional().describe('Language code'),
      },
    },
    greetingPrompt.handler,
  );

  server.registerPrompt(
    analysisPrompt.name,
    {
      title: 'Analysis Prompt',
      description: analysisPrompt.description,
      argsSchema: {
        topic: z.string().describe('Topic to analyze'),
        depth: z
          .string()
          .optional()
          .describe('Depth level: basic | intermediate | advanced'),
        include_examples: z
          .string()
          .optional()
          .describe('Include examples: true | false'),
      },
    },
    analysisPrompt.handler,
  );

  server.registerPrompt(
    multimodalPrompt.name,
    {
      title: 'Multimodal Prompt',
      description: multimodalPrompt.description,
      argsSchema: {
        task: z.string().describe('The analysis task to perform'),
        include_image: z.boolean().optional().describe('Include example image content'),
        include_audio: z.boolean().optional().describe('Include example audio content'),
        include_resource: z.boolean().optional().describe('Include embedded resource'),
      },
    },
    multimodalPrompt.handler,
  );

  logger.info('prompts', {
    message: `Registered ${prompts.length} prompts`,
    promptNames: prompts.map((p) => p.name),
  });

  // Override default prompts/list to add pagination
  try {
    const lowLevel = getLowLevelServer(server);
    lowLevel?.setRequestHandler?.('prompts/list', async (request: unknown) => {
      const cursor = (request as { params?: { cursor?: string } })?.params?.cursor;
      // Shape per spec: { prompts: [...], nextCursor?: string }
      const page = paginateArray(
        prompts.map((p) => ({
          name: p.name,
          title: undefined,
          description: p.description,
          arguments: undefined,
        })),
        cursor,
        50,
      );
      return {
        prompts: page.data,
        nextCursor: page.nextCursor,
      };
    });
  } catch (error) {
    // Non-fatal; SDK may already paginate
    logger.warning('prompts', {
      message: 'Failed to install custom prompts/list handler',
      error: (error as Error).message,
    });
  }
}

// Emit listChanged when prompts are updated
export function emitPromptsListChanged(server: McpServer): void {
  server.sendPromptListChanged();
  logger.debug('prompts', {
    message: 'Prompts list changed notification sent',
  });
}
