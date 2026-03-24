import { allTools } from './tools/index.js';
import { accounts } from './data/mock-inbox.js';
import { createTracker } from './state.js';
import { runTriagePhase } from './phases/triage.js';
import { runDraftSession } from './phases/draft.js';
import * as log from './logger.js';
import type { DraftSessionResult } from './types.js';

import { resolveModelForProvider } from '../../config.js';

const MODEL = resolveModelForProvider(process.env.MODEL ?? 'gpt-4.1');

export interface AgentResult {
  response: string;
  turns: number;
  draftSessions: number;
}

export const runAgent = async (task: string): Promise<AgentResult> => {
  const tracker = createTracker();

  log.banner({
    model: MODEL,
    accounts: accounts.map((a) => a.email),
    toolCount: allTools.length + 1,
    task,
  });

  log.inboxOverview(tracker.getAccounts(), tracker.getEmails(), tracker.getLabels());

  // Phase 1: Triage
  log.phaseHeader(1, 'Triage', 'Read, classify, label — no drafts');
  const triage = await runTriagePhase(MODEL, task, {
    tracker,
    hooks: {
      onSystemPromptInfo: log.systemPromptInfo,
      onTurnHeader: log.turnHeader,
      onToolCall: log.toolCall,
      onToolResult: log.toolResult,
      onToolError: log.toolError,
      onTurnKnowledgeAccess: (accesses) => {
        log.turnKnowledgeAccess(accesses as Parameters<typeof log.turnKnowledgeAccess>[0]);
      },
      onTurnChanges: (changes) => {
        log.turnChanges(changes as Parameters<typeof log.turnChanges>[0]);
      },
    },
  });

  // Phase 2: Isolated draft sessions
  log.phaseHeader(2, 'Draft Sessions', `${triage.replyPlans.length} isolated contexts`);

  const draftResults: DraftSessionResult[] = [];
  for (const plan of triage.replyPlans) {
    tracker.snapshot();
    draftResults.push(await runDraftSession(MODEL, plan));
    tracker.collectChanges();
  }

  log.finalSummary(tracker, draftResults);

  return {
    response: [
      `Triage completed in ${triage.turns} turns.`,
      `${triage.replyPlans.length} draft sessions executed with isolated KB scoping.`,
      `${draftResults.length} drafts created.`,
    ].join(' '),
    turns: triage.turns,
    draftSessions: draftResults.length,
  };
};
