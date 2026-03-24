import { knowledgeBase } from '../data/knowledge-base.js';
import { KB_CATEGORIES, type ContactType } from '../data/contacts.js';
import { assertAccountAccess } from './access-lock.js';

export interface ScopedKBResult {
  loaded: { id: string; title: string; category: string; content: string }[];
  blocked: { title: string; category: string; reason: string }[];
}

export const getScopedKnowledge = (account: string, contactType: ContactType): ScopedKBResult => {
  assertAccountAccess(account);
  const allowedCategories = new Set(KB_CATEGORIES[contactType]);

  const accountEntries = knowledgeBase.filter(
    (e) => e.account === 'shared' || e.account === account,
  );

  const loaded: ScopedKBResult['loaded'] = [];
  const blocked: ScopedKBResult['blocked'] = [];

  for (const entry of accountEntries) {
    if (allowedCategories.has(entry.category)) {
      loaded.push({ id: entry.id, title: entry.title, category: entry.category, content: entry.content });
    } else {
      blocked.push({ title: entry.title, category: entry.category, reason: `Category "${entry.category}" not permitted for contact type "${contactType}"` });
    }
  }

  const otherAccountEntries = knowledgeBase.filter(
    (e) => e.account !== 'shared' && e.account !== account,
  );
  for (const entry of otherAccountEntries) {
    blocked.push({ title: entry.title, category: entry.category, reason: `Belongs to ${entry.account} — account isolation` });
  }

  return { loaded, blocked };
};
