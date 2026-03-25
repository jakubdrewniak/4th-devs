import type { AddScenarioStep, NotificationWebhook } from '../types.js';

export const addScenario: AddScenarioStep[] = [
  {
    id: 'add-001',
    at: '2026-02-25T09:00:00+01:00',
    locationId: 'p-home',
    message:
      'Book a creative review with Marta and Luiza at that cafe on Planty tomorrow at 10:00. ' +
      'Please include both as guests and write a short agenda in the description.',
  },
  {
    id: 'add-002',
    at: '2026-02-25T09:10:00+01:00',
    locationId: 'p-office',
    message:
      'Schedule lunch with Kasia tomorrow around noon, somewhere near the office, maybe that Italian place. ' +
      'Please invite her and keep it at 60 minutes.',
  },
  {
    id: 'add-003',
    at: '2026-02-25T09:20:00+01:00',
    locationId: 'p-office',
    message:
      'Set up a meeting with Tomek Brandt on Thursday at 14:00 at the coworking space in Kazimierz. ' +
      'Keep a formal tone in the event description.',
  },
  {
    id: 'add-004',
    at: '2026-02-25T09:30:00+01:00',
    locationId: 'p-office',
    message:
      'I want to take Anna for dinner on Friday evening. She loves sushi, so find a good place and add her as a guest.',
  },
  {
    id: 'add-005',
    at: '2026-02-25T09:40:00+01:00',
    locationId: 'p-office',
    message:
      'Quick call with Piotr on Monday morning, 30 minutes. Make it a virtual event with a meeting link.',
  },
];

export const notificationWebhooks: NotificationWebhook[] = [
  {
    id: 'wh-001',
    at: '2026-02-26T09:15:00+01:00',
    locationId: 'p-home',
    payload: {
      type: 'event.upcoming',
      eventTitle: 'Creative review with Marta and Luiza',
      startsAt: '2026-02-26T10:00:00+01:00',
      minutesUntilStart: 45,
    },
  },
  {
    id: 'wh-002',
    at: '2026-02-26T11:15:00+01:00',
    locationId: 'p-office',
    payload: {
      type: 'event.upcoming',
      eventTitle: 'Lunch with Kasia Nowak',
      startsAt: '2026-02-26T12:00:00+01:00',
      minutesUntilStart: 45,
    },
  },
  {
    id: 'wh-003',
    at: '2026-02-26T13:15:00+01:00',
    locationId: 'p-trattoria',
    payload: {
      type: 'event.upcoming',
      eventTitle: 'Meeting with Tomek Brandt',
      startsAt: '2026-02-26T14:00:00+01:00',
      minutesUntilStart: 45,
    },
  },
  {
    id: 'wh-004',
    at: '2026-02-27T18:15:00+01:00',
    locationId: 'p-home',
    payload: {
      type: 'event.upcoming',
      eventTitle: 'Dinner with Anna Wisniewska',
      startsAt: '2026-02-27T19:00:00+01:00',
      minutesUntilStart: 45,
    },
  },
  {
    id: 'wh-005',
    at: '2026-03-02T08:30:00+01:00',
    locationId: 'p-home',
    payload: {
      type: 'event.upcoming',
      eventTitle: 'Call with Piotr Zielinski',
      startsAt: '2026-03-02T09:00:00+01:00',
      minutesUntilStart: 30,
    },
  },
];
