import type {
  GetPromptResult,
  PromptMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Schema for multimodal prompt arguments.
 */
export const MultimodalPromptArgsSchema = z.object({
  task: z
    .string()
    .describe('The analysis task to perform (e.g., "analyze this diagram")'),
  include_image: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include example image content'),
  include_audio: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include example audio content'),
  include_resource: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include embedded resource'),
});

export type MultimodalPromptArgs = z.infer<typeof MultimodalPromptArgsSchema>;

/**
 * Example image: 1x1 red pixel PNG (base64)
 * In production, this would be a real diagram, chart, or screenshot
 */
const EXAMPLE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/**
 * Example audio: Minimal WAV file (base64)
 * In production, this would be a real audio recording or speech sample
 */
const EXAMPLE_AUDIO_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQAAAAA=';

/**
 * Multimodal prompt: Demonstrates rich content types.
 * Shows how to include images, audio, and embedded resources in prompts.
 */
export const multimodalPrompt = {
  name: 'multimodal',
  description:
    'Generate analysis prompts with rich content (images, audio, embedded resources)',

  handler: async (args: unknown): Promise<GetPromptResult> => {
    logger.debug('multimodal_prompt', { message: 'Multimodal prompt called', args });

    const validation = MultimodalPromptArgsSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Invalid arguments: ${validation.error.message}`);
    }

    const { task, include_image, include_audio, include_resource } = validation.data;

    const messages: PromptMessage[] = [];

    // User message with text instruction
    messages.push({
      role: 'user',
      content: {
        type: 'text',
        text: `Task: ${task}\n\nPlease analyze the provided content below and provide detailed insights.`,
      },
    });

    // Optionally include image content
    if (include_image) {
      messages.push({
        role: 'user',
        content: {
          type: 'image',
          data: EXAMPLE_IMAGE_BASE64,
          mimeType: 'image/png',
          annotations: {
            audience: ['assistant'],
            priority: 0.9, // High priority - important for analysis
          },
        },
      });
    }

    // Optionally include audio content
    if (include_audio) {
      messages.push({
        role: 'user',
        content: {
          type: 'audio',
          data: EXAMPLE_AUDIO_BASE64,
          mimeType: 'audio/wav',
          annotations: {
            audience: ['assistant'],
            priority: 0.8,
          },
        },
      });
    }

    // Optionally include embedded resource
    if (include_resource) {
      messages.push({
        role: 'user',
        content: {
          type: 'resource',
          resource: {
            uri: 'docs://overview',
            mimeType: 'text/markdown',
            text: `# Context Document

This is an embedded resource that provides additional context for the analysis.

## Key Points
- Resources can be embedded directly in prompts
- This allows providing rich contextual information
- The LLM can reference this content in its analysis

Use this document as reference material when completing the task.`,
          },
        },
      });
    }

    // Assistant acknowledgment (optional, demonstrates multi-turn prompts)
    if (include_image || include_audio || include_resource) {
      messages.push({
        role: 'assistant',
        content: {
          type: 'text',
          text: "I've received the content. Let me analyze it for you.",
        },
      });
    }

    // Final user instruction
    messages.push({
      role: 'user',
      content: {
        type: 'text',
        text: 'Please provide a comprehensive analysis with specific observations and actionable recommendations.',
      },
    });

    logger.info('multimodal_prompt', {
      message: 'Multimodal prompt generated',
      task,
      content_types: {
        image: include_image,
        audio: include_audio,
        resource: include_resource,
      },
      message_count: messages.length,
    });

    return {
      description: `Multimodal analysis prompt for: ${task}`,
      messages,
    };
  },
};
