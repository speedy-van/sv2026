import { describe, expect, it } from 'vitest';
import {
  NotificationItemSchema, NotificationReadResponseSchema, NotificationReadSchema,
  NotificationsQuerySchema, NotificationsResponseSchema,
} from '../src';

const item = {
  id: 'contact-notification', type: 'contact.received', title: 'Contact message', body: 'A customer sent a message.',
  data: { eventType: 'contact.received', contactMessageId: 'contact-one' },
  readAt: null, createdAt: '2026-10-23T17:54:00.688Z',
};

describe('notification inbox contracts', () => {
  it('preserves old contact notifications and read timestamps', () => {
    expect(NotificationItemSchema.parse(item)).toEqual(item);
    expect(NotificationItemSchema.parse({ ...item, data: null, readAt: '2026-11-03T15:00:00.000Z' }).readAt).not.toBeNull();
  });
  it('returns a bounded page without using the page size as the unread count', () => {
    expect(NotificationsResponseSchema.parse({ items: [item], nextCursor: item.id, unreadCount: 75, badgeCount: 78 })).toMatchObject({ unreadCount: 75, badgeCount: 78 });
  });
  it.each([
    { unreadCount: -1, badgeCount: 0 },
    { unreadCount: 2, badgeCount: 1 },
    { unreadCount: 1.5, badgeCount: 2 },
  ])('rejects invalid or contradictory totals %j', (counts) => {
    expect(NotificationsResponseSchema.safeParse({ items: [], nextCursor: null, ...counts }).success).toBe(false);
  });
  it('defaults to fifty and bounds page size to one hundred', () => {
    expect(NotificationsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(NotificationsQuerySchema.parse({ cursor: 'next', limit: '100' })).toEqual({ cursor: 'next', limit: 100 });
    expect(NotificationsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(NotificationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(NotificationsQuerySchema.safeParse({ userId: 'other-user' }).success).toBe(false);
  });
  it('accepts explicit read actions and rejects client supplied counts or recipients', () => {
    expect(NotificationReadSchema.parse({ all: true })).toEqual({ all: true });
    expect(NotificationReadSchema.parse({ ids: [item.id] })).toEqual({ ids: [item.id] });
    expect(NotificationReadSchema.safeParse({ ids: [item.id], badgeCount: 0 }).success).toBe(false);
    expect(NotificationReadSchema.safeParse({ all: true, userId: 'other-user' }).success).toBe(false);
    expect(NotificationReadResponseSchema.parse({ ok: true })).toEqual({ ok: true });
  });
});
