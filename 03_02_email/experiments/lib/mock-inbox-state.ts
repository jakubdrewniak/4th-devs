import { drafts, emails, labels } from '../../src/data/mock-inbox.js';
import { knowledgeAccessLog } from '../../src/knowledge/access-log.js';
import type { Draft, Email, Label } from '../../src/types.js';

const initialState: {
  emails: Email[];
  labels: Label[];
  drafts: Draft[];
} = {
  emails: structuredClone(emails),
  labels: structuredClone(labels),
  drafts: structuredClone(drafts),
};

const restoreArray = <T>(target: T[], source: T[]): void => {
  target.splice(0, target.length, ...structuredClone(source));
};

export const resetMockInboxState = (): void => {
  restoreArray(emails, initialState.emails);
  restoreArray(labels, initialState.labels);
  restoreArray(drafts, initialState.drafts);
  knowledgeAccessLog.splice(0, knowledgeAccessLog.length);
};
