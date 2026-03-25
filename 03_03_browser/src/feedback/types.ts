export type ToolOutcome = 'success' | 'fail';

export interface ToolEvent {
  tool: string;
  outcome: ToolOutcome;
  args: Record<string, unknown>;
  error?: string;
  ts: number;
}

export interface FeedbackStats {
  total: number;
  successes: number;
  failures: number;
  byTool: Record<string, { calls: number; fails: number }>;
}

export interface FeedbackTracker {
  record: (event: ToolEvent) => void;
  consecutiveFailures: (tool?: string) => number;
  lastInstructionSite: () => string | null;
  generateHints: (tool: string, outcome: ToolOutcome, error?: string) => string[];
  stats: () => FeedbackStats;
}
