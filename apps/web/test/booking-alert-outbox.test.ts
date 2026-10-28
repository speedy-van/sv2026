import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  enqueue: vi.fn(),
  users: vi.fn(),
  booking: vi.fn(),
  settings: vi.fn(),
  notification: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null },
  enqueueOutbox: mocks.enqueue,
  prisma: {
    outboxEvent: { update: mocks.update },
    notification: { upsert: mocks.notification },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings }));
vi.mock('../src/server/auth/customer-links', () => ({
  manageLinkForBooking: vi.fn(() => 'private-manage-token'),
  bookingPurposeLink: vi.fn(() => 'private-track-token'),
}));
vi.mock('../src/server/services/customer-self-service', () => ({
  payLinkForExtraCharge: vi.fn(),
  payLinkForManualQuote: vi.fn(),
}));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: vi.fn() }));
vi.mock('../src/server/integrations/resend', () => ({ sendTransactionalEmail: vi.fn() }));

import { processOutboxEventNow } from '../src/server/outbox/processor';

const event = {
  id: 'event-unit',
  type: 'booking.confirmed',
  attempts: 1,
  payload: { bookingId: 'booking-unit' },
};
const tx = {
  booking: { findUnique: mocks.booking },
  user: { findMany: mocks.users },
  outboxEvent: { create: mocks.create },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockResolvedValue(event);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.users.mockResolvedValue([{ id: 'admin-unit', email: 'admin@example.test', name: 'Admin' }]);
  mocks.booking.mockResolvedValue({
    id: 'booking-unit',
    reference: 'SV-UNIT',
    contactEmail: 'customer@example.test',
    moveDate: new Date('2031-03-02T00:00:00.000Z'),
    completedAt: null,
    service: 'man-and-van',
    slot: 'MORNING',
    totalPence: 12345,
    pickup: { town: 'Glasgow', line1: 'Private address' },
    dropoff: { town: 'Edinburgh' },
  });
  mocks.settings.mockImplementation((key: string) =>
    Promise.resolve(
      key === 'web'
        ? { canonicalOrigin: 'https://example.test' }
        : key === 'company'
          ? { legalName: 'Unit Company' }
          : { emailPublic: 'support@example.test', emailAdminAlerts: [] },
    ),
  );
});

describe('confirmed booking notification fan-out with isolated outbox mocks', () => {
  it('uses the outbox delivery id as notification identity so replaying a channel does not create duplicate feed rows', async () => {
    mocks.update.mockResolvedValue({
      ...event,
      id: 'channel-unit',
      type: 'notification.create',
      payload: {
        title: 'New booking',
        body: 'Glasgow to Edinburgh',
        type: 'booking.confirmed',
        userId: 'admin-unit',
        data: { bookingId: 'booking-unit' },
      },
    });
    await processOutboxEventNow('channel-unit');
    await processOutboxEventNow('channel-unit');
    expect(mocks.notification).toHaveBeenCalledTimes(2);
    expect(mocks.notification).toHaveBeenCalledWith({
      where: { id: 'channel-unit' },
      update: {},
      create: {
        id: 'channel-unit',
        title: 'New booking',
        body: 'Glasgow to Edinburgh',
        type: 'booking.confirmed',
        userId: 'admin-unit',
        data: { bookingId: 'booking-unit' },
      },
    });
  });
  it('queues the bundled sound and the same delivery key and safe booking details for push and foreground feed', async () => {
    expect(await processOutboxEventNow(event.id)).toEqual({ done: 1, failed: 0 });
    expect(mocks.users).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' } }),
    );
    const push = mocks.create.mock.calls
      .map((args: unknown[]) => args[0])
      .find(
        (value: unknown) =>
          value &&
          typeof value === 'object' &&
          'data' in value &&
          typeof value.data === 'object' &&
          value.data &&
          'type' in value.data &&
          value.data.type === 'push.send',
      );
    const bodyMatcher: unknown = expect.stringContaining('Glasgow to Edinburgh');
    const notificationDataMatcher: unknown = expect.objectContaining({
      deliveryKey: 'event-unit:notification:admin-unit',
      bookingId: 'booking-unit',
    });
    expect(push).toMatchObject({
      data: {
        type: 'push.send',
        payload: {
          app: 'ADMIN',
          userId: 'admin-unit',
          category: 'NEW_BOOKING',
          sound: 'new-job.wav',
          timeSensitive: true,
          title: 'New booking - £123.45',
          body: bodyMatcher,
          data: {
            bookingId: 'booking-unit',
            deliveryKey: 'event-unit:notification:admin-unit',
            reference: 'SV-UNIT',
            pricePence: 12345,
            service: 'man-and-van',
            route: 'Glasgow to Edinburgh',
            type: 'NEW_BOOKING',
            url: 'speedyvan-admin://bookings/booking-unit',
          },
        },
      },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      tx,
      'notification.create',
      expect.objectContaining({
        userId: 'admin-unit',
        type: 'booking.confirmed',
        data: notificationDataMatcher,
      }),
      'event-unit:notification:admin-unit',
    );
    expect(JSON.stringify(push)).not.toMatch(/private-|customer@example|Private address/u);
  });
});
