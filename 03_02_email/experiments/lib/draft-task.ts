import { classifyContact, type ContactType } from '../../src/data/contacts.js';
import { emails } from '../../src/data/mock-inbox.js';
import { complete } from '../../src/core/completion.js';
import { buildDraftContext, buildDraftPrompt } from '../../src/prompts/draft.js';
import { lockKnowledgeToAccount, unlockKnowledge } from '../../src/knowledge/access-lock.js';
import { toCaseInput } from './index.js';

export interface DraftEvalTaskResult {
  caseId: string;
  draft: string;
  emailId: string;
  account: string;
  recipientEmail: string;
  contactType: ContactType;
}

const readRequiredString = (value: unknown, field: string, caseId: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[${caseId}] Missing or invalid "${field}" in dataset input.`);
  }
  return value;
};

export const runDraftEvalTask = async (params: {
  itemInput: unknown;
  model: string;
  userPrompt?: string;
}): Promise<DraftEvalTaskResult> => {
  const input = toCaseInput(params.itemInput);
  const caseId = input.id;

  const emailId = readRequiredString(input.emailId, 'emailId', caseId);
  const account = readRequiredString(input.account, 'account', caseId);
  const email = emails.find((candidate) => candidate.id === emailId && candidate.account === account);
  if (!email) {
    throw new Error(`[${caseId}] Email "${emailId}" not found for account "${account}".`);
  }

  const reason = typeof input.description === 'string' ? input.description : '';
  const contactType = classifyContact(account, email.from);

  lockKnowledgeToAccount(account);
  try {
    const context = buildDraftContext({
      emailId,
      account,
      recipientEmail: email.from,
      contactType,
      reason,
      categories: [],
    });

    const response = await complete({
      model: params.model,
      instructions: buildDraftPrompt(context),
      input: [{ role: 'user', content: params.userPrompt ?? 'Write the reply.' }],
    });

    return {
      caseId,
      draft: response.outputText ?? '',
      emailId,
      account,
      recipientEmail: email.from,
      contactType,
    };
  } finally {
    unlockKnowledge();
  }
};
