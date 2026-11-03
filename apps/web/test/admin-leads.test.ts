import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activity: vi.fn(), activityCursor: vi.fn(), stages: vi.fn(), bookings: vi.fn(), bookingCursor: vi.fn(), events: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: {
  bookingActivity: { findMany: mocks.activity, findFirst: mocks.activityCursor, groupBy: mocks.stages },
  booking: { findMany: mocks.bookings, findFirst: mocks.bookingCursor }, outboxEvent: { findMany: mocks.events },
} }));

import { readAdminAbandonedCheckouts, readAdminBookingActivity } from '../src/server/admin/leads';

const now = new Date('2031-03-01T12:00:00.000Z');
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const activity = { id, stage: 'MOVE', service: 'man-and-van', startedAt: new Date(now.getTime() - 180_000), lastSeenAt: now, quoteId: null, booking: null };
const booking = { id: 'booking-one', reference: 'SV-2031-0001', contactName: 'Test Customer', contactEmail: 'test@example.test', contactPhone: '+447700900000', service: 'man-and-van',
  pickup: {}, dropoff: {}, pickupPostcode: 'G11 5JY', dropoffPostcode: 'G12 8QQ', moveDate: new Date('2031-03-02T00:00:00.000Z'), slot: 'MORNING', totalPence: 12345, createdAt: new Date('2031-03-01T11:00:00.000Z') };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.activity.mockResolvedValue([]);
  mocks.stages.mockResolvedValue([]);
  mocks.bookings.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
});

describe('admin booking activity read model', () => {
  it('returns current counts from all active sessions rather than the page size, and a bounded cursor', async () => {
    mocks.activity.mockResolvedValue([activity, { ...activity, id: otherId }]);
    mocks.stages.mockResolvedValue([{ stage: 'MOVE', _count: { _all: 12 } }, { stage: 'PAYMENT', _count: { _all: 3 } }]);
    const result = await readAdminBookingActivity(new URLSearchParams({ limit: '1' }), now);
    expect(result.items).toEqual([{ id, stage: 'MOVE', service: 'man-and-van', startedAt: activity.startedAt.toISOString(), lastSeenAt: now.toISOString(), active: true, quoteId: null, booking: null }]);
    expect(result.counts).toEqual({ active: 15, SERVICE: 0, MOVE: 12, ITEMS: 0, DATE: 0, PAYMENT: 3 });
    expect(result.nextCursor).toBe(id);
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ where: { lastSeenAt: { gte: new Date(now.getTime() - 90_000), lte: now } }, take: 2, orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }] }));
  });

  it('allows recent inactive sessions only within the 24-hour retention window', async () => {
    mocks.activity.mockResolvedValue([{ ...activity, lastSeenAt: new Date(now.getTime() - 90_001) }]);
    const result = await readAdminBookingActivity(new URLSearchParams({ scope: 'recent' }), now);
    expect(result.items[0]?.active).toBe(false);
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ where: { lastSeenAt: { gte: new Date(now.getTime() - 86_400_000), lte: now } }, take: 31 }));
    expect(result.counts.active).toBe(0);
    expect(result.measurement).toBe('consenting-browsers');
  });

  it('exposes a customer only for a linked submitted booking and hides deleted bookings', async () => {
    const linkedBooking = { id: 'booking-one', reference: 'SV-2031-0001', status: 'PENDING_PAYMENT', contactName: 'Test Customer', deletedAt: null };
    mocks.activity.mockResolvedValue([{ ...activity, booking: linkedBooking }, { ...activity, id: otherId, booking: { ...linkedBooking, deletedAt: now } }]);
    const result = await readAdminBookingActivity(new URLSearchParams(), now);
    expect(result.items[0]?.booking).toEqual({ id: 'booking-one', reference: 'SV-2031-0001', status: 'PENDING_PAYMENT', customerName: 'Test Customer' });
    expect(result.items[1]?.booking).toBeNull();
    expect(result.items[0]).not.toHaveProperty('contactEmail');
  });

  it('rejects a cursor outside the requested activity window before listing', async () => {
    mocks.activityCursor.mockResolvedValue(null);
    await expect(readAdminBookingActivity(new URLSearchParams({ cursor: id }), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.activityCursor).toHaveBeenCalledWith({ where: { id, lastSeenAt: { gte: new Date(now.getTime() - 90_000), lte: now } }, select: { id: true } });
    expect(mocks.activity).not.toHaveBeenCalled();
  });
});

describe('real abandoned web checkouts', () => {
  it('restricts results to nondeleted expired website bookings created during the last 30 days', async () => {
    mocks.bookings.mockResolvedValue([booking]);
    const result = await readAdminAbandonedCheckouts(new URLSearchParams(), now);
    expect(mocks.bookings).toHaveBeenCalledWith(expect.objectContaining({ where: { source: 'WEB', status: 'EXPIRED', deletedAt: null, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000), lte: now } }, take: 31 }));
    expect(result.items[0]).toEqual({ id: booking.id, reference: booking.reference, customerName: booking.contactName, contactEmail: booking.contactEmail, contactPhone: booking.contactPhone, service: booking.service,
      routeLabel: 'G11 5JY to G12 8QQ', moveDate: '2031-03-02', slot: 'MORNING', totalPence: 12345, createdAt: booking.createdAt.toISOString(), expiredAt: null });
    expect(result.items[0]).not.toHaveProperty('resumeUrl');
  });

  it('uses durable expiry evidence rather than an unrelated later update timestamp', async () => {
    mocks.bookings.mockResolvedValue([{ ...booking, updatedAt: now }]);
    const expiredAt = new Date('2031-03-01T11:30:00.000Z');
    mocks.events.mockResolvedValue([{ dedupeKey: 'booking.checkout_abandoned:booking-one', createdAt: expiredAt }]);
    const result = await readAdminAbandonedCheckouts(new URLSearchParams(), now);
    expect(result.items[0]?.expiredAt).toBe(expiredAt.toISOString());
    expect(mocks.events).toHaveBeenCalledWith({ where: { type: 'booking.checkout_abandoned', dedupeKey: { in: ['booking.checkout_abandoned:booking-one'] } }, select: { dedupeKey: true, createdAt: true } });
  });

  it('paginates and searches inside the expired website scope without inventing records', async () => {
    mocks.bookingCursor.mockResolvedValue({ id: 'previous-page' });
    mocks.bookings.mockResolvedValue([booking, { ...booking, id: 'booking-two' }]);
    const result = await readAdminAbandonedCheckouts(new URLSearchParams({ limit: '1', cursor: 'previous-page', q: 'G11' }), now);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe('booking-one');
    const bookingQuery: unknown = mocks.bookings.mock.calls[0]?.[0];
    expect(bookingQuery).toMatchObject({ where: { source: 'WEB', status: 'EXPIRED', OR: [{ reference: { contains: 'G11', mode: 'insensitive' } }, { contactName: { contains: 'G11', mode: 'insensitive' } }, { contactEmail: { contains: 'G11', mode: 'insensitive' } }, { contactPhone: { contains: 'G11', mode: 'insensitive' } }, { pickupPostcode: { contains: 'G11', mode: 'insensitive' } }, { dropoffPostcode: { contains: 'G11', mode: 'insensitive' } }] }, cursor: { id: 'previous-page' }, skip: 1, take: 2 });
    const expiryQuery: unknown = mocks.events.mock.calls[0]?.[0];
    expect(expiryQuery).toMatchObject({ where: { dedupeKey: { in: ['booking.checkout_abandoned:booking-one'] } } });
  });

  it('rejects a cursor from outside the visible search scope', async () => {
    mocks.bookingCursor.mockResolvedValue(null);
    await expect(readAdminAbandonedCheckouts(new URLSearchParams({ cursor: 'foreign-booking', q: 'G11' }), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.bookings).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it('returns an honest empty response without querying expiry events', async () => {
    expect(await readAdminAbandonedCheckouts(new URLSearchParams(), now)).toEqual({ generatedAt: now.toISOString(), windowDays: 30, items: [], nextCursor: null });
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it.each([new URLSearchParams({ limit: '101' }), new URLSearchParams({ unexpected: 'value' })])('rejects invalid filters before reading activity or bookings', async (search) => {
    await expect(readAdminBookingActivity(search, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(readAdminAbandonedCheckouts(search, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.bookings).not.toHaveBeenCalled();
  });
});
