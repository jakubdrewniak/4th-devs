import type { ToolDefinition } from '../types.js';
import { emailTools } from './emails.js';
import { labelTools } from './labels.js';
import { knowledgeTools } from './knowledge.js';

export const allTools: ToolDefinition[] = [
  ...emailTools,
  ...labelTools,
  ...knowledgeTools,
];

export const toolMap = new Map(allTools.map((t) => [t.name, t]));
