import type {
  GetPromptResult,
  PromptMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { AnalysisPromptArgs } from '../schemas/prompts.js';
import { logger } from '../utils/logger.js';

const depthInstructions = {
  basic: 'Provide a high-level overview with key concepts and basic explanations.',
  intermediate:
    'Include detailed explanations, relationships between concepts, and practical considerations.',
  advanced:
    'Cover complex aspects, edge cases, advanced techniques, and expert-level insights.',
};

export const analysisPrompt = {
  name: 'analysis',
  description:
    'Generate a structured analysis prompt for any topic with customizable depth',

  handler: async (args: unknown): Promise<GetPromptResult> => {
    logger.debug('analysis_prompt', { message: 'Analysis prompt called', args });

    const validation = AnalysisPromptArgs.safeParse(args);
    if (!validation.success) {
      throw new Error(`Invalid arguments: ${validation.error.message}`);
    }

    const { topic, depth, include_examples } = validation.data;
    const depthInstruction = depthInstructions[depth];

    let analysisText = `Please provide a comprehensive analysis of "${topic}". ${depthInstruction}`;

    if (include_examples) {
      analysisText +=
        ' Include relevant examples and case studies to illustrate key points.';
    }

    analysisText += ` 

Structure your analysis with:
1. Introduction and context
2. Key components or aspects
3. Benefits and advantages
4. Challenges and limitations
5. Current trends or developments
6. Conclusion and recommendations

Ensure the analysis is well-researched, balanced, and provides actionable insights.`;

    const messages: PromptMessage[] = [
      {
        role: 'user',
        content: {
          type: 'text',
          text: analysisText,
        },
      },
    ];

    logger.info('analysis_prompt', {
      message: 'Analysis prompt generated',
      topic,
      depth,
      include_examples,
    });

    return { messages };
  },
};
