import { drafts } from '../data/mock-inbox.js';
import { complete } from '../core/completion.js';
import { buildDraftContext, buildDraftPrompt } from '../prompts/draft.js';
import { lockKnowledgeToAccount, unlockKnowledge } from '../knowledge/access-lock.js';
import type { ReplyPlan, DraftSessionResult } from '../types.js';
import * as log from '../logger.js';

let draftCounter = 0;

export const runDraftSession = async (
  model: string,
  plan: ReplyPlan,
): Promise<DraftSessionResult> => {
  lockKnowledgeToAccount(plan.account);
  try {
    const ctx = buildDraftContext(plan);

    log.draftSessionHeader(plan, ctx.scoped);

    const result = await complete({
      model,
      instructions: buildDraftPrompt(ctx),
      input: [{ role: 'user', content: 'Write the reply.' }],
    });

    const body = result.outputText ?? '';

    draftCounter++;
    const draft = {
      id: `draft-${Date.now()}-${draftCounter}`,
      account: plan.account,
      to: [ctx.email.from],
      cc: [] as string[],
      subject: `Re: ${ctx.email.subject}`,
      body,
      inReplyTo: ctx.email.id,
      createdAt: new Date().toISOString(),
    };
    drafts.push(draft);

    log.draftSessionResult(draft.id, body);

    return {
      plan,
      draftId: draft.id,
      kbEntriesLoaded: ctx.scoped.loaded,
      kbEntriesBlocked: ctx.scoped.blocked,
      draftBody: body,
    };
  } finally {
    unlockKnowledge();
  }
};
