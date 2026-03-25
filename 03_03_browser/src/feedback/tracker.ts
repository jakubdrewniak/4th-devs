import type { FeedbackStats, FeedbackTracker, ToolEvent, ToolOutcome } from './types.js';

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
};

const toInstructionSiteKey = (domain: string): string => {
  const [firstLabel] = domain.split('.').filter(Boolean);
  return firstLabel ?? domain;
};

const buildStats = (history: ToolEvent[]): FeedbackStats => ({
  total: history.length,
  successes: history.filter((event) => event.outcome === 'success').length,
  failures: history.filter((event) => event.outcome === 'fail').length,
  byTool: Object.fromEntries(
    [...new Set(history.map((event) => event.tool))].map((toolName) => [
      toolName,
      {
        calls: history.filter((event) => event.tool === toolName).length,
        fails: history.filter((event) => event.tool === toolName && event.outcome === 'fail').length,
      },
    ]),
  ),
});

export const createFeedbackTracker = (): FeedbackTracker => {
  const history: ToolEvent[] = [];

  const recentOf = (tool: string, n = 5): ToolEvent[] =>
    history.filter((event) => event.tool === tool).slice(-n);

  const consecutiveFailures = (tool?: string): number => {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (tool && history[i].tool !== tool) continue;
      if (history[i].outcome === 'fail') count++;
      else break;
    }
    return count;
  };

  const lastInstructionSite = (): string | null => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].tool !== 'navigate' || history[i].outcome !== 'success') continue;
      return toInstructionSiteKey(extractDomain(String(history[i].args.url ?? '')));
    }
    return null;
  };

  const generateHints = (tool: string, outcome: ToolOutcome, error?: string): string[] => {
    if (outcome !== 'fail') return [];

    if (error?.includes('Invalid JSON arguments')) {
      const hints = [
        'Arguments must be a single valid JSON object (double-quoted keys/strings, no trailing commas, no markdown fences).',
      ];

      if (tool === 'fs_write') {
        hints.push(
          'For fs_write, include path/operation/content and ensure content is JSON-escaped (newlines as \\n, quotes escaped).',
          'If content is large (HTML/markdown), write in smaller chunks (create + append) to reduce malformed JSON risk.',
        );
      }

      return hints;
    }

    if (tool === 'click' && error?.includes('timeout')) {
      return ['The element may not be visible. Try scrolling first, or use a broader selector.'];
    }

    if (tool === 'evaluate' && error?.includes('Cannot read properties')) {
      return ['A querySelector returned null. The expected DOM element is missing.'];
    }

    const recentFailures = recentOf(tool, 3).filter((event) => event.outcome === 'fail').length;
    if (recentFailures >= 3) {
      return ['Multiple failures detected for this tool. Consider changing strategy before retrying.'];
    }

    return [];
  };

  return {
    record: (event: ToolEvent): void => {
      history.push(event);
    },
    consecutiveFailures,
    lastInstructionSite,
    generateHints,
    stats: () => buildStats(history),
  };
};
