import { emails } from '../data/mock-inbox.js';
import { getScopedKnowledge, type ScopedKBResult } from '../knowledge/scoping.js';
import type { ReplyPlan, Email } from '../types.js';

export interface DraftPromptContext {
  plan: ReplyPlan;
  email: Email;
  thread: Email[];
  scoped: ScopedKBResult;
}

export const buildDraftContext = (plan: ReplyPlan): DraftPromptContext => {
  const email = emails.find((e) => e.id === plan.emailId)!;
  const thread = emails
    .filter((e) => e.threadId === email.threadId && e.id !== email.id)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const scoped = getScopedKnowledge(plan.account, plan.contactType);

  return { plan, email, thread, scoped };
};

const renderKB = (scoped: ScopedKBResult): string =>
  scoped.loaded.length > 0
    ? scoped.loaded.map((e) => `### ${e.title}\n${e.content}`).join('\n\n')
    : 'No knowledge base entries available for this contact type.';

const renderThread = (thread: Email[]): string =>
  thread.length > 0
    ? thread.map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`).join('\n\n---\n\n')
    : '';

export const buildDraftPrompt = (ctx: DraftPromptContext): string => {
  const { plan, email, thread, scoped } = ctx;
  const threadSection = renderThread(thread);

  return `You are drafting a reply to an email. Write ONLY the reply body — no subject line, no metadata.

## Context
- You are: ${plan.account}
- Replying to: ${email.from} (contact type: ${plan.contactType})
- Reason for reply: ${plan.reason}

## Email to reply to
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

${email.body}
${threadSection ? `\n## Previous messages in thread\n\n${threadSection}` : ''}
## Available Knowledge
${renderKB(scoped)}

## Rules
- Use ONLY the knowledge provided above. Do not reference information not present here.
- Match the language of the original email (if they wrote in Polish, reply in Polish).
- If you cannot fulfill a request (e.g. no banking access, no attachment access), explicitly say so.
- If the email requests data you don't have in the knowledge above, say you cannot share that information.
- Be concise: under 150 words.`;
};
