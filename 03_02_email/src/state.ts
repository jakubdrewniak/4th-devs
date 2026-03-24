import { emails, labels, drafts, accounts } from './data/mock-inbox.js';
import { knowledgeAccessLog, type KnowledgeAccess } from './knowledge/access-log.js';
import type { Draft } from './types.js';

export interface EmailSnapshot {
  id: string;
  account: string;
  from: string;
  subject: string;
  labelIds: string[];
  isRead: boolean;
}

interface Snapshot {
  emails: EmailSnapshot[];
  labelIds: Set<string>;
  drafts: Draft[];
}

export interface Change {
  type: 'label_added' | 'label_removed' | 'label_created' | 'draft_created';
  account: string;
  emailId?: string;
  emailSubject?: string;
  labelName?: string;
  labelColor?: string;
  draftTo?: string[];
  draftSubject?: string;
}

const resolveLabel = (id: string) =>
  labels.find((l) => l.id === id);

const takeSnapshot = (): Snapshot => ({
  emails: emails.map((e) => ({
    id: e.id,
    account: e.account,
    from: e.from,
    subject: e.subject,
    labelIds: [...e.labelIds],
    isRead: e.isRead,
  })),
  labelIds: new Set(labels.map((l) => l.id)),
  drafts: [...drafts],
});

const diff = (before: Snapshot, after: Snapshot): Change[] => {
  const changes: Change[] = [];

  for (const afterEmail of after.emails) {
    const beforeEmail = before.emails.find((e) => e.id === afterEmail.id);
    if (!beforeEmail) continue;

    const added = afterEmail.labelIds.filter((l) => !beforeEmail.labelIds.includes(l));
    const removed = beforeEmail.labelIds.filter((l) => !afterEmail.labelIds.includes(l));

    for (const labelId of added) {
      const label = resolveLabel(labelId);
      changes.push({
        type: 'label_added',
        account: afterEmail.account,
        emailId: afterEmail.id,
        emailSubject: afterEmail.subject,
        labelName: label?.name ?? labelId,
        labelColor: label?.color,
      });
    }

    for (const labelId of removed) {
      const label = resolveLabel(labelId);
      changes.push({
        type: 'label_removed',
        account: afterEmail.account,
        emailId: afterEmail.id,
        emailSubject: afterEmail.subject,
        labelName: label?.name ?? labelId,
      });
    }
  }

  for (const labelId of after.labelIds) {
    if (!before.labelIds.has(labelId)) {
      const label = resolveLabel(labelId);
      if (label) {
        changes.push({
          type: 'label_created',
          account: label.account,
          labelName: label.name,
          labelColor: label.color,
        });
      }
    }
  }

  const newDrafts = after.drafts.slice(before.drafts.length);
  for (const draft of newDrafts) {
    changes.push({
      type: 'draft_created',
      account: draft.account,
      draftTo: draft.to,
      draftSubject: draft.subject,
    });
  }

  return changes;
};

export const createTracker = () => {
  const initial = takeSnapshot();
  let current = takeSnapshot();
  const allChanges: Change[] = [];
  let kbLogCursor = 0;

  return {
    snapshot: () => {
      current = takeSnapshot();
      kbLogCursor = knowledgeAccessLog.length;
    },

    collectChanges: (): Change[] => {
      const after = takeSnapshot();
      const changes = diff(current, after);
      allChanges.push(...changes);
      current = after;
      return changes;
    },

    collectKnowledgeAccess: (): KnowledgeAccess[] => {
      const newEntries = knowledgeAccessLog.slice(kbLogCursor);
      kbLogCursor = knowledgeAccessLog.length;
      return newEntries;
    },

    allChanges: () => [...allChanges],
    allKnowledgeAccess: () => [...knowledgeAccessLog],
    initialEmails: () => initial.emails,

    getEmails: () => emails,
    getLabels: () => labels,
    getDrafts: () => drafts,
    getAccounts: () => accounts,
  };
};

export type StateTracker = ReturnType<typeof createTracker>;
