import type { NotificationRecord } from '../types.js';
import { getEnvironment } from './environment.js';

const records: NotificationRecord[] = [];
let nextId = 1;

export const pushNotification = (
  payload: Omit<NotificationRecord, 'id' | 'createdAt'>,
): NotificationRecord => {
  const created: NotificationRecord = {
    id: `notif-${String(nextId++).padStart(3, '0')}`,
    createdAt: getEnvironment().currentTime,
    ...payload,
  };
  records.push(created);
  return created;
};

export const listNotifications = (): NotificationRecord[] => [...records];
