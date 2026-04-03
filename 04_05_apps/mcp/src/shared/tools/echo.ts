import { z } from 'zod';
import { defineTool } from './types.js';

/**
 * Input schema for echo tool.
 */
export const echoInputSchema = z.object({
  message: z.string().min(1).describe('Message to echo back'),
  uppercase: z.boolean().optional().describe('Convert message to uppercase'),
});

/**
 * Echo tool - works in both Node and Workers.
 * Simple test tool that echoes back input.
 */
export const echoTool = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'Echo back a message, optionally transformed',
  inputSchema: echoInputSchema,
  outputSchema: {
    echoed: z.string().describe('The echoed message'),
    length: z.number().describe('Message length'),
  },
  annotations: {
    title: 'Echo Message',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (args) => {
    const message = args.message;
    const echoed = args.uppercase ? message.toUpperCase() : message;

    const result = {
      echoed,
      length: echoed.length,
    };

    return {
      content: [{ type: 'text', text: echoed }],
      structuredContent: result,
    };
  },
});
