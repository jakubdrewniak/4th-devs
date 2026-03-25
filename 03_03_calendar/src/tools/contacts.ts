import { contacts } from '../data/contacts.js';
import type { Contact, ToolDefinition } from '../types.js';

const scoreContact = (contact: Contact, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const haystack = [
    contact.name,
    contact.email,
    contact.company ?? '',
    contact.role ?? '',
    contact.notes ?? '',
    ...(contact.preferences ?? []),
  ]
    .join(' ')
    .toLowerCase();

  if (haystack.includes(q)) return 100;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 10 : score), 0);
};

export const contactTools: ToolDefinition[] = [
  {
    name: 'search_contacts',
    description: 'Search contacts by name, email, company, role, notes, and preferences.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, e.g. "Kasia", "Tomek Brandt", "investor"' },
        limit: { type: 'number', description: 'Maximum number of contacts to return (default 5)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.query !== 'string' || args.query.trim().length === 0) {
        return { error: 'query is required and must be a non-empty string' };
      }

      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 5;
      const query = args.query;

      const ranked = contacts
        .map((contact) => ({ contact, score: scoreContact(contact, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ contact }) => contact);

      return { total: ranked.length, contacts: ranked };
    },
  },
  {
    name: 'get_contact',
    description: 'Get a contact by exact contact ID.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact ID, e.g. c-001' },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.contact_id !== 'string') {
        return { error: 'contact_id is required and must be a string' };
      }

      const contact = contacts.find((item) => item.id === args.contact_id);
      if (!contact) return { error: `Contact not found: ${args.contact_id}` };
      return contact;
    },
  },
];
