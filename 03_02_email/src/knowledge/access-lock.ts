let lockedAccount: string | null = null;

export const lockKnowledgeToAccount = (account: string): void => {
  if (lockedAccount !== null) {
    throw new Error(
      `Knowledge base is already locked to "${lockedAccount}". Unlock before locking to "${account}".`,
    );
  }
  lockedAccount = account;
};

export const unlockKnowledge = (): void => {
  lockedAccount = null;
};

export const getLockedAccount = (): string | null => lockedAccount;

export const assertAccountAccess = (requestedAccount: string): void => {
  if (lockedAccount !== null && requestedAccount !== lockedAccount) {
    throw new Error(
      `ACCESS_DENIED: Knowledge base is locked to "${lockedAccount}". ` +
        `Cannot access data for "${requestedAccount}".`,
    );
  }
};
