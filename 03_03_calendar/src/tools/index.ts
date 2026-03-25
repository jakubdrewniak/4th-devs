import type { ToolDefinition } from '../types.js';
import { calendarTools } from './calendar.js';
import { contactTools } from './contacts.js';
import { mapTools } from './map.js';
import { notificationTools } from './notifications.js';
import { placeTools } from './places.js';
import { webSearchTools } from './web-search.js';

export const addPhaseTools: ToolDefinition[] = [
  ...contactTools,
  ...placeTools,
  ...webSearchTools,
  ...calendarTools,
];

export const notificationPhaseTools: ToolDefinition[] = [
  ...calendarTools,
  ...mapTools,
  ...notificationTools,
];

export const allTools: ToolDefinition[] = [
  ...addPhaseTools,
  ...notificationPhaseTools,
];

export const toolMap = new Map<string, ToolDefinition>(allTools.map((tool) => [tool.name, tool]));
