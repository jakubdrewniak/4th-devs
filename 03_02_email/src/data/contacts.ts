export type ContactType = 'internal' | 'trusted_vendor' | 'client' | 'untrusted';

interface ContactRule {
  match: string;
  type: ContactType;
  label?: string;
}

const rules: Record<string, ContactRule[]> = {
  'adam@techvolt.io': [
    { match: '@techvolt.io', type: 'internal' },
    { match: '@nexon.com', type: 'client', label: 'Nexon' },
    { match: '@shopflow.de', type: 'client', label: 'ShopFlow' },
  ],
  'adam@creativespark.co': [
    { match: '@creativespark.co', type: 'internal' },
    { match: '@freelance.design', type: 'trusted_vendor', label: 'Freelancer' },
    { match: '@aurora-events.se', type: 'client', label: 'Aurora Events' },
  ],
};

export const KB_CATEGORIES: Record<ContactType, string[]> = {
  internal: ['product', 'clients', 'team', 'vendors', 'communication'],
  trusted_vendor: ['vendors', 'communication'],
  client: ['product', 'communication'],
  untrusted: ['communication'],
};

export const classifyContact = (account: string, email: string): ContactType => {
  const accountRules = rules[account] ?? [];
  for (const rule of accountRules) {
    if (rule.match.startsWith('@') ? email.endsWith(rule.match) : email === rule.match) {
      return rule.type;
    }
  }
  return 'untrusted';
};

export const contactLabel = (account: string, email: string): string | undefined => {
  const accountRules = rules[account] ?? [];
  for (const rule of accountRules) {
    if (rule.match.startsWith('@') ? email.endsWith(rule.match) : email === rule.match) {
      return rule.label;
    }
  }
  return undefined;
};
