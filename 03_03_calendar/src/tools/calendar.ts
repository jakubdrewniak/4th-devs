import { addEvent, getEventById, getEvents, getEventsInRange } from '../data/calendar.js';
import { contacts } from '../data/contacts.js';
import { places } from '../data/places.js';
import type { CalendarEvent, CalendarGuest, ToolDefinition } from '../types.js';

const parseIso = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toGuestList = (emails: unknown): CalendarGuest[] => {
  if (!Array.isArray(emails)) return [];

  return emails
    .filter((email): email is string => typeof email === 'string' && email.length > 0)
    .map((email) => {
      const matched = contacts.find((contact) => contact.email.toLowerCase() === email.toLowerCase());
      return {
        name: matched?.name ?? email.split('@')[0],
        email,
        status: 'pending' as const,
      };
    });
};

const sortByStart = (items: CalendarEvent[]): CalendarEvent[] =>
  [...items].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildEventSearchText = (event: CalendarEvent): string =>
  [
    event.title,
    event.locationName ?? '',
    event.description ?? '',
    ...event.guests.map((guest) => `${guest.name} ${guest.email}`),
  ].join(' ');

const scoreTitleMatch = (
  event: CalendarEvent,
  normalizedQuery: string,
  queryTokens: string[],
): number => {
  const haystack = normalizeText(buildEventSearchText(event));
  if (!haystack) return 0;
  if (normalizedQuery.length === 0) return 0;

  let score = 0;
  if (haystack.includes(normalizedQuery)) score += 100;

  const normalizedEventTitle = normalizeText(event.title);
  if (normalizedQuery.includes(normalizedEventTitle) || normalizedEventTitle.includes(normalizedQuery)) {
    score += 40;
  }

  score += queryTokens.reduce((acc, token) => (haystack.includes(token) ? acc + 10 : acc), 0);
  return score;
};

const scoreTimeProximity = (event: CalendarEvent, expected: Date | null): number => {
  if (!expected) return 0;

  const diffMinutes = Math.abs(new Date(event.start).getTime() - expected.getTime()) / 60000;
  if (diffMinutes <= 15) return 40;
  if (diffMinutes <= 60) return 30;
  if (diffMinutes <= 180) return 20;
  if (diffMinutes <= 720) return 10;
  return 0;
};

export const calendarTools: ToolDefinition[] = [
  {
    name: 'create_event',
    description: 'Create a calendar event with guests, location, and description.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start datetime in ISO format with timezone' },
        end: { type: 'string', description: 'End datetime in ISO format with timezone' },
        location_id: { type: 'string', description: 'Optional place ID for in-person event' },
        guest_emails: { type: 'array', items: { type: 'string' }, description: 'Optional guest email list' },
        description: { type: 'string', description: 'Optional event description' },
        is_virtual: { type: 'boolean', description: 'Whether this is a virtual meeting (default false)' },
        meeting_link: { type: 'string', description: 'Optional meeting link for virtual events' },
      },
      required: ['title', 'start', 'end'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.title !== 'string' || args.title.trim().length === 0) {
        return { error: 'title is required and must be a non-empty string' };
      }

      const start = parseIso(args.start);
      const end = parseIso(args.end);
      if (!start || !end) return { error: 'start and end must be valid ISO datetimes' };
      if (start.getTime() >= end.getTime()) {
        return { error: 'end must be later than start' };
      }

      const isVirtual = typeof args.is_virtual === 'boolean' ? args.is_virtual : false;
      const locationId = typeof args.location_id === 'string' ? args.location_id : undefined;
      const place = locationId ? places.find((item) => item.id === locationId) : undefined;

      if (!isVirtual && locationId && !place) {
        return { error: `Unknown location_id: ${locationId}` };
      }

      const created = addEvent({
        title: args.title.trim(),
        start: typeof args.start === 'string' ? args.start : start.toISOString(),
        end: typeof args.end === 'string' ? args.end : end.toISOString(),
        guests: toGuestList(args.guest_emails),
        locationId: place?.id,
        locationName: place?.name,
        address: place?.address,
        description: typeof args.description === 'string' ? args.description : undefined,
        isVirtual,
        meetingLink: typeof args.meeting_link === 'string' ? args.meeting_link : undefined,
      });

      return { created: true, event: created };
    },
  },
  {
    name: 'list_events',
    description: 'List calendar events, optionally filtered by date range or text query.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Optional start datetime ISO filter (inclusive)' },
        to: { type: 'string', description: 'Optional end datetime ISO filter (inclusive)' },
        query: { type: 'string', description: 'Optional title query' },
        limit: { type: 'number', description: 'Optional max number of events (default 20)' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args) => {
      const from = parseIso(args.from);
      const to = parseIso(args.to);

      let items = from && to ? getEventsInRange(from.toISOString(), to.toISOString()) : getEvents();

      if (typeof args.query === 'string' && args.query.trim().length > 0) {
        const query = args.query.toLowerCase();
        items = items.filter((event) => event.title.toLowerCase().includes(query));
      }

      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 20;
      const sorted = sortByStart(items).slice(0, limit);

      return { total: sorted.length, events: sorted };
    },
  },
  {
    name: 'get_event',
    description: 'Get one event by exact event ID.',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID, e.g. evt-001' },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.event_id !== 'string') {
        return { error: 'event_id is required and must be a string' };
      }

      const event = getEventById(args.event_id);
      if (!event) return { error: `Event not found: ${args.event_id}` };
      return event;
    },
  },
  {
    name: 'find_event',
    description:
      'Find an event by fuzzy title match (title + guest names + description), ' +
      'optionally weighted by expected start timestamp.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title or partial title' },
        starts_at: { type: 'string', description: 'Optional expected start datetime (ISO)' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.title !== 'string' || args.title.trim().length === 0) {
        return { error: 'title is required and must be a non-empty string' };
      }

      const normalizedTitle = normalizeText(args.title);
      const tokens = normalizedTitle.split(' ').filter((token) => token.length >= 2);
      const startsAt = parseIso(args.starts_at);

      const ranked = getEvents()
        .map((event) => {
          const titleScore = scoreTitleMatch(event, normalizedTitle, tokens);
          const timeScore = scoreTimeProximity(event, startsAt);
          return {
            event,
            titleScore,
            timeScore,
            totalScore: titleScore + timeScore,
          };
        })
        .filter((item) => item.titleScore > 0 || item.timeScore >= 30)
        .sort((a, b) => b.totalScore - a.totalScore);

      if (ranked.length === 0) return { error: `No event found for title query: ${args.title}` };

      return {
        event: ranked[0].event,
        candidates: ranked.length,
        confidence: ranked[0].totalScore,
      };
    },
  },
];
