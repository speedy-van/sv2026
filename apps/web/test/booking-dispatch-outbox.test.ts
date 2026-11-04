import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), enqueue: vi.fn(), users: vi.fn(), booking: vi.fn(), assignments: vi.fn(), previousAssignment: vi.fn(), settings: vi.fn(), push: vi.fn(), email: vi.fn() }));
vi.mock('@sv/db', () => {
  const tx = { booking: { findUnique: mocks.booking }, assignment: { findMany: mocks.assignments, findFirst: mocks.previousAssignment }, user: { findMany: mocks.users }, outboxEvent: { create: mocks.create, update: mocks.update } };
  return { Prisma: { JsonNull: null }, enqueueOutbox: mocks.enqueue, prisma: { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } };
});
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings }));
vi.mock('../src/server/auth/customer-links', () => ({ manageLinkForBooking: vi.fn(() => 'private-manage'), bookingPurposeLink: vi.fn(() => 'private-purpose') }));
vi.mock('../src/server/services/customer-self-service', () => ({ payLinkForExtraCharge: vi.fn(), payLinkForManualQuote: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: mocks.push }));
vi.mock('../src/server/integrations/mail', () => ({ sendTransactionalEmail: mocks.email }));
vi.mock('../src/server/mail/delivery', () => ({ processMailDelivery: vi.fn() }));
import { processOutboxEventNow } from '../src/server/outbox/processor';

const snapshot = { kind: 'booking.offered', bookingId: 'booking-one', bookingVersion: 4, driverIds: ['driver-one'], assignmentIds: ['assignment-old'] };
function domain(type: string, payload: unknown) { mocks.update.mockResolvedValue({ id: 'event-one', attempts: 1, type, payload }); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.booking.mockResolvedValue({ id: 'booking-one', version: 4, status: 'CONFIRMED', deletedAt: null, dispatchStatus: 'OFFERED', driverId: null,
    reference: 'SV-TEST12', contactEmail: 'customer@example.test', moveDate: new Date('2031-03-02T00:00:00Z'), completedAt: null,
    service: 'man-and-van', pricingVersion: { config: DEFAULT_PRICING_CONFIG }, slot: 'MORNING', totalPence: 10000, paidPence: 10000, refundedPence: 0, pickup: { town: 'Glasgow' }, dropoff: { town: 'Edinburgh' }, driver: { user: { name: 'Driver One' } } });
  mocks.assignments.mockResolvedValue([{ driverId: 'driver-one' }]);
  mocks.users.mockResolvedValue([]);
  mocks.settings.mockImplementation((key: string) => Promise.resolve(key === 'web' ? { canonicalOrigin: 'https://example.test' }
    : key === 'company' ? { legalName: 'Unit Company' } : { emailPublic: 'office@example.test', emailAdminAlerts: [] }));
});

describe('assignment notification identity survives asynchronous delivery', () => {
  it('does not look up an arbitrary later assignment when previousDriverId was explicitly null', async () => {
    domain('booking.rescheduled', { bookingId: 'booking-one', previousDriverId: null });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.previousAssignment).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps the old previous-driver lookup only for historical payloads without that field', async () => {
    mocks.previousAssignment.mockResolvedValue({ driverId: 'previous-driver' });
    domain('booking.rescheduled', { bookingId: 'booking-one' });
    await processOutboxEventNow('event-one');
    expect(mocks.previousAssignment).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ userId: 'previous-driver' }) as unknown }) as unknown }));
  });
  it('uses only the snapshotted live offer ids and stores a private guard for the eventual push', async () => {
    domain('booking.offered', { bookingId: snapshot.bookingId, bookingVersion: 4, driverIds: snapshot.driverIds, assignmentIds: snapshot.assignmentIds });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.assignments).toHaveBeenCalledWith({ where: { id: { in: ['assignment-old'] }, bookingId: 'booking-one', driverId: { in: ['driver-one'] }, status: 'OFFERED', expiresAt: { gt: expect.any(Date) as Date } }, select: { driverId: true } });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ userId: 'driver-one', dispatchSnapshot: snapshot }) as unknown }) as unknown }));
  });
  it('drops a replaced or expired offer instead of notifying the replacement drivers', async () => {
    mocks.assignments.mockResolvedValue([]);
    domain('booking.offered', { bookingId: snapshot.bookingId, bookingVersion: 4, driverIds: snapshot.driverIds, assignmentIds: snapshot.assignmentIds });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('retains a valid original offer across a later contact or note edit', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-one', version: 5, status: 'CONFIRMED', deletedAt: null, dispatchStatus: 'OFFERED', driverId: null });
    domain('push.send', { app: 'DRIVER', userId: 'driver-one', title: 'Offer', body: 'A move', category: 'JOB_OFFER', sound: 'job-offer.wav', dispatchSnapshot: snapshot });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.push).toHaveBeenCalledOnce();
  });
  it('rechecks a derived push before delivery so a withdrawal after expansion cannot ring', async () => {
    mocks.assignments.mockResolvedValue([]);
    domain('push.send', { app: 'DRIVER', userId: 'driver-one', title: 'Offer', body: 'A move', category: 'JOB_OFFER', sound: 'job-offer.wav', dispatchSnapshot: snapshot });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('does not send a snapshotted offer to a different driver even if another offer remains valid', async () => {
    domain('push.send', { app: 'DRIVER', userId: 'driver-other', title: 'Offer', body: 'A move', category: 'JOB_OFFER', sound: 'job-offer.wav', dispatchSnapshot: snapshot });
    await processOutboxEventNow('event-one');
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('drops an accepted-driver email if its assignment was replaced before email delivery', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-one', version: 5, status: 'CONFIRMED', deletedAt: null, dispatchStatus: 'ACCEPTED', driverId: 'new-driver' });
    mocks.assignments.mockResolvedValue([]);
    domain('email.send', { to: ['customer@example.test'], template: 'driver-assigned', data: {}, dispatchSnapshot: { ...snapshot, kind: 'booking.driver_accepted' } });
    expect(await processOutboxEventNow('event-one')).toEqual({ done: 1, failed: 0 });
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
