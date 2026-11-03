import type { ExpoPushMessage } from 'expo-server-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ booking: vi.fn(), read: vi.fn(), devices: vi.fn(), previousTickets: vi.fn(), ticket: vi.fn(), send: vi.fn(), counts: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: {
  booking: { findFirst: mocks.booking }, notification: { findFirst: mocks.read }, pushDevice: { findMany: mocks.devices },
  pushTicket: { findMany: mocks.previousTickets, create: mocks.ticket },
} }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ PUSH_MODE: 'live', EXPO_ACCESS_TOKEN: 'unit-only' }) }));
vi.mock('../src/server/notifications/counts', () => ({ readNotificationCounts: mocks.counts }));
vi.mock('../src/server/integrations/expo-transport', () => ({ withExpoTransport: (operation: (client: { sendPushNotificationsAsync: typeof mocks.send }) => unknown) => operation({ sendPushNotificationsAsync: mocks.send }) }));
vi.mock('expo-server-sdk', () => ({ Expo: class {
  static isExpoPushToken() { return true; }
  chunkPushNotifications(messages: ExpoPushMessage[]) { return [messages]; }
} }));
import { sendPushOutbox, type PushSendPayload } from '../src/server/integrations/expo-push';

const payload: PushSendPayload = { app: 'ADMIN', category: 'NEW_BOOKING', body: 'Unit booking', title: 'Unit booking', sound: 'new-job.wav', timeSensitive: true, userId: 'admin-one',
  data: { bookingId: 'booking-one', eventType: 'booking.confirmed.repeat' } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.booking.mockResolvedValue({ id: 'booking-one' });
  mocks.read.mockResolvedValue(null);
  mocks.devices.mockResolvedValue([{ id: 'phone-one', app: 'ADMIN', userId: 'admin-one', expoPushToken: 'ExpoPushToken[unit]' }]);
  mocks.previousTickets.mockResolvedValue([]);
  mocks.counts.mockResolvedValue({ badgeCount: 1, unreadCount: 1 });
  mocks.send.mockResolvedValue([{ status: 'ok', id: 'ticket-one' }]);
});

describe('repeat eligibility rechecked at delivery without a real provider', () => {
  it('drops a queued repeat when any admin has acknowledged the initial booking notification', async () => {
    mocks.read.mockResolvedValue({ id: 'read-notification' });
    expect(await sendPushOutbox(payload, 'repeat-one')).toEqual({ devices: 0, tickets: 0 });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ where: { type: 'booking.confirmed', data: { path: ['bookingId'], equals: 'booking-one' }, readAt: { not: null } }, select: { id: true } });
    expect(mocks.devices).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('requires the booking still to be unassigned at delivery and suppresses stale assigned/canceled/deleted jobs', async () => {
    mocks.booking.mockResolvedValue(null);
    expect(await sendPushOutbox(payload, 'repeat-one')).toEqual({ devices: 0, tickets: 0 });
    const query: unknown = mocks.booking.mock.calls[0]?.[0];
    expect(query).toMatchObject({ where: { id: 'booking-one', status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', deletedAt: null } });
    expect(mocks.devices).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('sends a still-eligible repeat only through the mocked transport and rechecks on every retry', async () => {
    expect(await sendPushOutbox(payload, 'repeat-one')).toEqual({ devices: 1, tickets: 1 });
    expect(mocks.send).toHaveBeenCalledOnce();
    mocks.read.mockResolvedValue({ id: 'newly-read' });
    expect(await sendPushOutbox(payload, 'repeat-one')).toEqual({ devices: 0, tickets: 0 });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('keeps the first paid-booking alert independent of repeat-only acknowledgement suppression', async () => {
    await sendPushOutbox({ ...payload, data: { bookingId: 'booking-one', eventType: 'booking.confirmed' } }, 'original-one');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
    const query: unknown = mocks.booking.mock.calls[0]?.[0];
    expect(query).not.toMatchObject({ where: { dispatchStatus: 'UNASSIGNED' } });
  });
});
