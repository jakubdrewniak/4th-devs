import type { CalendarEvent } from '../types.js';

const seedEvents: CalendarEvent[] = [
  {
    id: 'evt-seed-001',
    title: 'Sprint 14 Planning',
    start: '2026-02-25T14:00:00+01:00',
    end: '2026-02-25T15:00:00+01:00',
    locationId: 'p-office',
    locationName: 'TechVolt Office',
    address: 'ul. Przemysłowa 12, 30-701 Kraków',
    guests: [
      { name: 'Kasia Nowak', email: 'kasia.nowak@techvolt.io', status: 'accepted' },
    ],
    description: 'Sprint 14 planning session. Agenda: retro, API v3 migration, Nexon capacity.',
    isVirtual: false,
  },
  {
    id: 'evt-seed-002',
    title: 'Dentist',
    start: '2026-02-27T10:00:00+01:00',
    end: '2026-02-27T11:00:00+01:00',
    guests: [],
    description: 'Regular checkup. Dr. Mazur, ul. Karmelicka 30.',
    isVirtual: false,
  },
];

export const events: CalendarEvent[] = [...seedEvents];

let nextId = 1;

export const addEvent = (
  event: Omit<CalendarEvent, 'id'>,
): CalendarEvent => {
  const created: CalendarEvent = { ...event, id: `evt-${String(nextId++).padStart(3, '0')}` };
  events.push(created);
  return created;
};

export const getEvents = (): CalendarEvent[] => [...events];

export const getEventById = (id: string): CalendarEvent | undefined =>
  events.find((e) => e.id === id);

export const getEventsInRange = (start: string, end: string): CalendarEvent[] => {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  return events.filter((e) => {
    const eStart = new Date(e.start).getTime();
    return eStart >= from && eStart <= to;
  });
};
