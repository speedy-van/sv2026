import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  txUpdate: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  enqueue: vi.fn(),
  users: vi.fn(),
  booking: vi.fn(),
  settings: vi.fn(),
  notification: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null },
  enqueueOutbox: mocks.enqueue,
  prisma: {
    outboxEvent: { update: mocks.update, upsert: mocks.upsert },
    notification: { upsert: mocks.notification },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings }));
vi.mock('../src/server/auth/customer-links', () => ({
  contactEmailHash: (email: string) => `hash:${email}`,
  manageLinkForBooking: vi.fn(() => 'private-manage-token'),
  bookingPurposeLink: vi.fn(() => 'private-track-token'),
}));
vi.mock('../src/server/services/customer-self-service', () => ({
  payLinkForExtraCharge: vi.fn(),
  payLinkForManualQuote: vi.fn(),
}));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: vi.fn() }));
vi.mock('../src/server/integrations/mail', () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock('../src/server/mail/delivery', () => ({ processMailDelivery: vi.fn() }));

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
  outboxEvent: { create: mocks.create, update: mocks.txUpdate },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockResolvedValue(event);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.users.mockResolvedValue([{ id: 'admin-unit', email: 'admin@example.test', name: 'Admin' }]);
  mocks.booking.mockResolvedValue({
    id: 'booking-unit',
    status: 'CONFIRMED', deletedAt: null,
    reference: 'SV-UNIT',
    contactEmail: 'customer@example.test',
    contactName: 'Private Customer',
    moveDate: new Date('2031-03-02T00:00:00.000Z'),
    completedAt: null,
    service: 'man-and-van',
    pricingVersion: { config: { ...DEFAULT_PRICING_CONFIG, services: { ...DEFAULT_PRICING_CONFIG.services, rubbish: { label: 'Retired service' } } } },
    slot: 'MORNING',
    totalPence: 12345,
    paidPence: 10000,
    refundedPence: 500,
    pickup: { town: 'Glasgow', flat: 'Flat 4', line1: 'Private address', line2: 'Private entrance', postcode: 'G1 1AA', lat: 55.86, lng: -4.25, label: 'Pickup', source: 'MANUAL' },
    dropoff: { town: 'Edinburgh', line1: 'Private destination', postcode: 'EH1 1AA', lat: 55.95, lng: -3.19, label: 'Dropoff', source: 'MANUAL' },
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
  it.each([{}, { bookingId: '' }, { bookingId: '   ' }, { bookingId: 7 }])('fails a malformed confirmation root visibly before fan-out: %j', async (payload) => {
    mocks.update.mockResolvedValue({ ...event, payload });
    expect(await processOutboxEventNow(event.id)).toEqual({ done: 0, failed: 1 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.txUpdate).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: event.id },
      data: { claimedAt: null, lastError: 'MAIL_BOOKING_CONFIRMATION_MISSING_BOOKING', status: 'FAILED' },
    });
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
  it('still persists the required customer email when no optional admin recipient exists', async () => {
    mocks.users.mockResolvedValue([]);
    expect(await processOutboxEventNow(event.id)).toEqual({ done: 1, failed: 0 });
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(tx, 'email.send', expect.objectContaining({
      template: 'booking-confirmed', to: ['customer@example.test'],
    }), 'event-unit:email:booking-confirmed:customer@example.test');
  });
  it('completes the domain root inside the same transaction that enqueues its channel jobs', async () => {
    expect(await processOutboxEventNow(event.id)).toEqual({ done: 1, failed: 0 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      data: { attempts: { increment: 1 }, claimedAt: expect.any(Date) as Date, status: 'PROCESSING' },
      where: { id: event.id },
      select: { attempts: true, id: true, payload: true, type: true },
    });
    expect(mocks.enqueue).toHaveBeenCalled();
    for (const args of mocks.enqueue.mock.calls) expect(args[0]).toBe(tx);
    expect(mocks.txUpdate).toHaveBeenCalledExactlyOnceWith({
      data: { claimedAt: null, lastError: null, processedAt: expect.any(Date) as Date, status: 'DONE' },
      where: { id: event.id },
    });
    expect(mocks.txUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...mocks.enqueue.mock.invocationCallOrder));
  });
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
            service: 'Man and van',
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
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, 'email.send', {
      template: 'booking-confirmed',
      to: ['customer@example.test'],
      actionEmailGuard: { kind: 'booking-confirmation', id: 'booking-unit', emailHash: 'hash:customer@example.test' },
      data: expect.objectContaining({
        customerName: 'Private Customer',
        serviceLabel: 'Man and van',
        amountPence: 12345,
        totalPence: 12345,
        paidPence: 10000,
        refundedPence: 500,
        balancePence: 2845,
        pickupLabel: 'Flat 4, Private address, Private entrance, Glasgow, G1 1AA',
        dropoffLabel: 'Private destination, Edinburgh, EH1 1AA',
        manageUrl: '/manage/session?token=private-manage-token',
      }) as unknown,
    }, 'event-unit:email:booking-confirmed:customer@example.test');
    expect(JSON.stringify(push)).not.toMatch(/private-|customer@example|Private Customer|Private address|Private entrance|Private destination|G1 1AA|EH1 1AA/u);
    expect(JSON.stringify(push)).not.toMatch(/paidPence|refundedPence|balancePence/u);
  });
});
