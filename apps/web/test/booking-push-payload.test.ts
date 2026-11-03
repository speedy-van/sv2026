import type { ExpoPushMessage } from 'expo-server-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  devices: vi.fn(),
  count: vi.fn(),
  ticket: vi.fn(),
  send: vi.fn(),
  user: vi.fn(),
  booking: vi.fn(),
  previousTickets: vi.fn(),
  updateDevice: vi.fn(),
  deviceCount: vi.fn(),
  environment: vi.fn(),
  chatEligible: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  enqueueOutbox: vi.fn(),
  prisma: {
    pushDevice: { findMany: mocks.devices, update: mocks.updateDevice, count: mocks.deviceCount },
    notification: { count: mocks.count },
    pushTicket: { create: mocks.ticket, findMany: mocks.previousTickets },
    user: { findUnique: mocks.user },
    booking: { findFirst: mocks.booking },
  },
}));
vi.mock('../src/server/env', () => ({
  serverEnv: mocks.environment,
}));
vi.mock('../src/server/chat/push', () => ({ shouldSendChatPush: mocks.chatEligible }));
vi.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken(token: unknown) {
      return typeof token === 'string' && token.startsWith('ExpoPushToken[');
    }
    chunkPushNotifications(messages: ExpoPushMessage[]) {
      return [messages];
    }
    sendPushNotificationsAsync(messages: ExpoPushMessage[]) {
      return mocks.send(messages) as Promise<unknown>;
    }
  },
}));

import { sendPushOutbox } from '../src/server/integrations/expo-push';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.devices.mockResolvedValue([
    { id: 'device-unit', userId: 'admin-unit', app: 'ADMIN', expoPushToken: 'ExpoPushToken[unit]' },
  ]);
  mocks.count.mockResolvedValue(3);
  mocks.send.mockResolvedValue([{ status: 'ok', id: 'ticket-unit' }]);
  mocks.booking.mockResolvedValue({ id: 'booking-unit' });
  mocks.previousTickets.mockResolvedValue([]);
  mocks.deviceCount.mockResolvedValue(1);
  mocks.environment.mockReturnValue({ EXPO_ACCESS_TOKEN: 'unit-fake-token', PUSH_MODE: 'live' });
  mocks.chatEligible.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('native booking push payload with isolated Expo and database mocks', () => {
  it('sends the bundled custom sound with time-sensitive priority and badge while checking current admin status', async () => {
    expect(
      await sendPushOutbox(
        {
          app: 'ADMIN',
          userId: 'admin-unit',
          title: 'New booking',
          body: 'Glasgow to Edinburgh',
          category: 'NEW_BOOKING',
          sound: 'new-job.wav',
          timeSensitive: true,
          data: { bookingId: 'booking-unit', deliveryKey: 'delivery-unit' },
        },
        'outbox-unit',
      ),
    ).toEqual({ devices: 1, tickets: 1 });
    expect(mocks.devices).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          app: 'ADMIN',
          enabled: true,
          userId: 'admin-unit',
          user: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        },
      }),
    );
    expect(mocks.send).toHaveBeenCalledWith([
      {
        badge: 3,
        body: 'Glasgow to Edinburgh',
        categoryId: 'NEW_BOOKING',
        data: { bookingId: 'booking-unit', deliveryKey: 'delivery-unit', type: 'NEW_BOOKING' },
        interruptionLevel: 'time-sensitive',
        priority: 'high',
        sound: 'new-job.wav',
        title: 'New booking',
        to: 'ExpoPushToken[unit]',
        ttl: 3600,
      },
    ]);
    expect(mocks.ticket).toHaveBeenCalledWith({
      data: {
        error: null,
        outboxEventId: 'outbox-unit',
        pushDeviceId: 'device-unit',
        status: 'ok',
        ticketId: 'ticket-unit',
      },
    });
  });
  it('does not send when no active authorised recipient device remains', async () => {
    mocks.devices.mockResolvedValue([]);
    mocks.user.mockResolvedValue({ id: 'admin-unit', status: 'DISABLED', role: 'ADMIN' });
    expect(
      await sendPushOutbox(
        {
          app: 'ADMIN',
          userId: 'admin-unit',
          title: 'New booking',
          body: 'Route',
          category: 'NEW_BOOKING',
          sound: 'new-job.wav',
          data: { bookingId: 'booking-unit' },
        },
        'outbox-unit',
      ),
    ).toEqual({ devices: 0, tickets: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps driver alerts restricted to active drivers and their own app', async () => {
    mocks.devices.mockResolvedValue([]);
    await sendPushOutbox(
      {
        app: 'DRIVER',
        userId: 'driver-unit',
        title: 'Job offer',
        body: 'Route',
        category: 'JOB_OFFER',
        sound: 'job-offer.wav',
      },
      'outbox-unit',
    );
    expect(mocks.devices).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          app: 'DRIVER',
          enabled: true,
          userId: 'driver-unit',
          user: { status: 'ACTIVE', role: 'DRIVER' },
        },
      }),
    );
  });
  it('discards a queued alert when its booking no longer matches confirmed, visible, upcoming criteria in London time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-03-30T23:30:00.000Z'));
    mocks.booking.mockResolvedValue(null);
    try {
      expect(
        await sendPushOutbox(
          {
            app: 'ADMIN',
            userId: 'admin-unit',
            title: 'New booking',
            body: 'Route',
            category: 'NEW_BOOKING',
            sound: 'new-job.wav',
            data: { bookingId: 'booking-unit' },
          },
          'outbox-unit',
        ),
      ).toEqual({ devices: 0, tickets: 0 });
      expect(mocks.booking).toHaveBeenCalledWith({
        where: {
          id: 'booking-unit',
          status: 'CONFIRMED',
          deletedAt: null,
          moveDate: { gte: new Date('2031-03-31T00:00:00.000Z') },
        },
        select: { id: true },
      });
      expect(mocks.devices).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('lets the explicit notification-health test sound without inventing a booking id', async () => {
    await sendPushOutbox(
      {
        app: 'ADMIN',
        userId: 'admin-unit',
        title: 'Test notification',
        body: 'Test sound',
        category: 'NEW_BOOKING',
        sound: 'new-job.wav',
        data: { eventType: 'admin.test_push' },
      },
      'outbox-unit',
    );
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('uses the owner-selected sound for ordinary admin alerts while preserving the driver sound', async () => {
    const payload = { userId: 'admin-unit', title: 'Changed', body: 'Open the app', category: 'CHANGE', sound: 'default' as const };
    await sendPushOutbox({ ...payload, app: 'ADMIN' }, 'event-admin');
    expect(mocks.send).toHaveBeenLastCalledWith([expect.objectContaining({ sound: 'new-job.wav' })]);
    await sendPushOutbox({ ...payload, app: 'DRIVER', sound: 'job-offer.wav' }, 'event-driver');
    expect(mocks.send).toHaveBeenLastCalledWith([expect.objectContaining({ sound: 'job-offer.wav' })]);
  });

  it('checks chat relevance at delivery and uses its bundled sound and deep link', async () => {
    const data = { conversationId: 'conversation-unit', messageId: 'message-unit', url: 'speedyvan-admin://chat/conversation-unit' };
    const payload = { app: 'ADMIN' as const, userId: 'admin-unit', title: 'New message', body: 'Open the conversation', category: 'CHAT_MESSAGE', sound: 'chat-message.wav' as const, data };
    await sendPushOutbox(payload, 'chat-event');
    expect(mocks.chatEligible).toHaveBeenCalledExactlyOnceWith(data);
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenLastCalledWith([expect.objectContaining({ sound: 'chat-message.wav', data: { ...data, type: 'CHAT_MESSAGE' } })]);
    mocks.chatEligible.mockResolvedValue(false);
    mocks.send.mockClear();
    mocks.devices.mockClear();
    await expect(sendPushOutbox(payload, 'chat-stale')).resolves.toEqual({ devices: 0, tickets: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.devices).not.toHaveBeenCalled();
  });

  it('retries a rejected device without ringing devices already accepted by Expo', async () => {
    mocks.devices.mockResolvedValue([
      { id: 'device-one', userId: 'admin-unit', app: 'ADMIN', expoPushToken: 'ExpoPushToken[one]' },
      { id: 'device-two', userId: 'admin-unit', app: 'ADMIN', expoPushToken: 'ExpoPushToken[two]' },
    ]);
    const accepted: { pushDeviceId: string }[] = [];
    mocks.previousTickets.mockImplementation(() => Promise.resolve([...accepted]));
    mocks.ticket.mockImplementation(({ data }: { data: { status: string; pushDeviceId: string } }) => {
      if (data.status === 'ok') accepted.push({ pushDeviceId: data.pushDeviceId });
      return Promise.resolve();
    });
    mocks.send.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-one' },
      { status: 'error', message: 'Try again', details: { error: 'MessageRateExceeded' } },
    ]).mockResolvedValueOnce([{ status: 'ok', id: 'ticket-two' }]);
    const payload = { app: 'ADMIN' as const, userId: 'admin-unit', title: 'New booking', body: 'Route', category: 'NEW_BOOKING', sound: 'new-job.wav' as const, data: { bookingId: 'booking-unit' } };
    await expect(sendPushOutbox(payload, 'retry-event')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', message: 'Push delivery was not accepted: MessageRateExceeded.' });
    await expect(sendPushOutbox(payload, 'retry-event')).resolves.toEqual({ devices: 2, tickets: 1 });
    expect(mocks.send).toHaveBeenLastCalledWith([expect.objectContaining({ to: 'ExpoPushToken[two]' })]);
    await expect(sendPushOutbox(payload, 'retry-event')).resolves.toEqual({ devices: 2, tickets: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.previousTickets).toHaveBeenCalledWith({
      select: { pushDeviceId: true },
      where: { outboxEventId: 'retry-event', status: 'ok', ticketId: { not: { startsWith: 'capture:' } } },
    });
  });

  it('records available tickets but rejects an incomplete provider response for a durable retry', async () => {
    mocks.send.mockResolvedValue([]);
    await expect(sendPushOutbox({ app: 'ADMIN', userId: 'admin-unit', title: 'Alert', body: 'Open the app', category: 'CHANGE', sound: 'default' }, 'missing-ticket')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE', message: 'Push delivery was not accepted: UnexpectedTicketCount.',
    });
    expect(mocks.ticket).not.toHaveBeenCalled();
  });

  it('disables an unregistered phone while keeping provider message text out of stored errors', async () => {
    mocks.user.mockResolvedValue({ id: 'admin-unit', status: 'ACTIVE', role: 'ADMIN', email: 'admin@example.test' });
    mocks.send.mockResolvedValue([{ status: 'error', message: 'Private token ExpoPushToken[unit]', details: { error: 'DeviceNotRegistered' } }]);
    await expect(sendPushOutbox({ app: 'ADMIN', userId: 'admin-unit', title: 'Alert', body: 'Open the app', category: 'CHANGE', sound: 'default' }, 'disabled-event')).resolves.toEqual({ devices: 1, tickets: 1 });
    expect(mocks.updateDevice).toHaveBeenCalledWith({ data: { enabled: false, lastError: 'DeviceNotRegistered' }, where: { id: 'device-unit' } });
    const unregistered: unknown = expect.objectContaining({ status: 'error', error: 'DeviceNotRegistered' });
    expect(mocks.ticket).toHaveBeenCalledWith({ data: unregistered });
    mocks.send.mockResolvedValue([{ status: 'error', message: 'Private token ExpoPushToken[unit]' }]);
    await expect(sendPushOutbox({ app: 'ADMIN', userId: 'admin-unit', title: 'Alert', body: 'Open the app', category: 'CHANGE', sound: 'default' }, 'unknown-error')).rejects.toThrow('UnknownPushError');
    const unknownError: unknown = expect.objectContaining({ error: 'UnknownPushError' });
    expect(mocks.ticket).toHaveBeenLastCalledWith({ data: unknownError });
  });

  it.each(['missing-token', 'capture'] as const)('fails production %s explicitly rather than claiming a live send', async (mode) => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.environment.mockReturnValue({ PUSH_MODE: mode === 'capture' ? 'capture' : 'live' });
    await expect(sendPushOutbox({ app: 'ADMIN', userId: 'admin-unit', title: 'Alert', body: 'Open the app', category: 'CHANGE', sound: 'default' }, 'config-event')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.ticket).not.toHaveBeenCalled();
  });
});
