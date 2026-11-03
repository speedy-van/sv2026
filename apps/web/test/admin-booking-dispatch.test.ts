import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), booking: vi.fn(), bookings: vi.fn(), update: vi.fn(), drivers: vi.fn(), vans: vi.fn(),
  assignments: vi.fn(), count: vi.fn(), create: vi.fn(), withdraw: vi.fn(), offer: vi.fn(), audit: vi.fn(), lock: vi.fn(), outbox: vi.fn() }));
vi.mock('@sv/db', async () => {
  const actual = await import('../../../packages/db/src/locks');
  return { ...actual, prisma: { $transaction: mocks.transaction }, lockSlot: mocks.lock, enqueueOutbox: mocks.outbox };
});
import { acceptAdminBookingOffer, assertAdminBookingResourcesForTarget, assignAdminBooking, declineAdminBookingOffer, offerAdminBooking, readAdminAssignmentOptions, unassignAdminBooking } from '../src/server/admin/booking-dispatch';
import type { DbTx } from '@sv/db';

const date = new Date('2031-03-02T00:00:00Z');
const now = new Date('2031-03-01T10:00:00Z');
const actor = { userId: 'admin', requestId: 'request', role: 'ADMIN' as const };
const current = { id: 'booking', reference: 'SV-BOOK01', version: 4, deletedAt: null, status: 'CONFIRMED', jobStage: 'NOT_STARTED',
  dispatchStatus: 'UNASSIGNED', driverId: null, vanId: null, moveDate: date, slot: 'MORNING', blocksSlots: 2 };
const driver = { userId: 'driver', defaultVanId: 'van', licenceExpiry: null, user: { name: 'Driver One', status: 'ACTIVE' }, unavailabilities: [] };
const van = { id: 'van', registration: 'UNIT01', label: 'Van One', active: true, motExpiry: null, insuranceExpiry: null, taxExpiry: null };
const tx = { booking: { findUnique: mocks.booking, findMany: mocks.bookings, updateMany: mocks.update }, driverProfile: { findMany: mocks.drivers },
  van: { findMany: mocks.vans }, assignment: { findMany: mocks.assignments, findFirst: mocks.offer, count: mocks.count, createMany: mocks.create, updateMany: mocks.withdraw }, auditLog: { create: mocks.audit } };
const input = { expectedVersion: 4, driverId: 'driver', mode: 'DIRECT' as const };

beforeEach(() => {
  vi.resetAllMocks(); mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  mocks.booking.mockResolvedValue({ ...current }); mocks.bookings.mockResolvedValue([]); mocks.update.mockResolvedValue({ count: 1 });
  mocks.drivers.mockResolvedValue([{ ...driver }]); mocks.vans.mockResolvedValue([{ ...van }]); mocks.assignments.mockResolvedValue([]);
  mocks.withdraw.mockResolvedValue({ count: 1 }); mocks.offer.mockResolvedValue({ id: 'offer' });
  mocks.count.mockResolvedValue(0);
});

describe('admin driver dispatch', () => {
  it('assigns a real available driver and default vehicle atomically with audit and outbox', async () => {
    expect(await assignAdminBooking('booking', input, actor, now)).toEqual({ ok: true, id: 'booking', version: 5 });
    expect(mocks.update).toHaveBeenCalledWith(containing({ where: containing({ version: 4, status: 'CONFIRMED', jobStage: 'NOT_STARTED' }),
      data: { dispatchStatus: 'ACCEPTED', driverId: 'driver', vanId: 'van', version: 5 } }));
    expect(mocks.create).toHaveBeenCalledWith({ data: [containing({ driverId: 'driver', status: 'ACCEPTED', respondedAt: now, expiresAt: null })] });
    expect(mocks.audit).toHaveBeenCalledOnce();
    const assignments = mocks.create.mock.calls[0]?.[0] as { data: { id: string }[] };
    expect(mocks.outbox).toHaveBeenCalledWith(tx, 'booking.assigned', {
      bookingId: 'booking', bookingVersion: 5, driverIds: ['driver'], assignmentIds: assignments.data.map((assignment) => assignment.id),
    }, 'admin-booking:booking:5:dispatch');
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('creates OFFER semantics with an expiry without silently accepting it', async () => {
    await assignAdminBooking('booking', { ...input, mode: 'OFFER' }, actor, now);
    expect(mocks.update).toHaveBeenCalledWith(containing({ data: containing({ dispatchStatus: 'OFFERED', driverId: null }) }));
    expect(mocks.create).toHaveBeenCalledWith({ data: [containing({ status: 'OFFERED', respondedAt: null, expiresAt: new Date(now.getTime() + 30 * 60_000) })] });
  });
  it('rejects stale versions and jobs that have started without creating offers', async () => {
    await expect(assignAdminBooking('booking', { ...input, expectedVersion: 3 }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.booking.mockResolvedValue({ ...current, jobStage: 'LOADING', status: 'IN_PROGRESS' });
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    { user: { name: 'Driver', status: 'DISABLED' } },
    { licenceExpiry: new Date('2031-03-01T00:00:00Z') },
    { unavailabilities: [{ slot: 'AFTERNOON' }] },
  ])('rejects an unavailable driver %#', async (override) => {
    mocks.drivers.mockResolvedValue([{ ...driver, ...override }]);
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('checks overlapping covered periods for both driver and vehicle', async () => {
    mocks.bookings.mockResolvedValue([{ slot: 'AFTERNOON', blocksSlots: 1, driverId: 'driver', vanId: 'other' }]);
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.bookings.mockResolvedValue([{ slot: 'AFTERNOON', blocksSlots: 1, driverId: 'other', vanId: 'van' }]);
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.bookings.mockResolvedValue([{ slot: 'EVENING', blocksSlots: 1, driverId: 'driver', vanId: 'van' }]);
    await expect(assignAdminBooking('booking', input, actor, now)).resolves.toMatchObject({ ok: true });
  });
  it.each([{ active: false }, { insuranceExpiry: new Date('2031-03-01T00:00:00Z') }])('rejects inactive or expired vehicles %#', async (override) => {
    mocks.vans.mockResolvedValue([{ ...van, ...override }]);
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('requires an explicit van if the driver has no default', async () => {
    mocks.drivers.mockResolvedValue([{ ...driver, defaultVanId: null }]);
    await expect(assignAdminBooking('booking', input, actor, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(assignAdminBooking('booking', { ...input, vanId: 'van' }, actor, now)).resolves.toMatchObject({ ok: true });
  });
  it('withdraws a replaced driver and notifies only through the same transaction outbox', async () => {
    mocks.booking.mockResolvedValue({ ...current, dispatchStatus: 'ACCEPTED', driverId: 'previous', vanId: 'van' });
    mocks.assignments.mockImplementation((query: { where: { bookingId: unknown } }) => Promise.resolve(query.where.bookingId === 'booking' ? [{ driverId: 'previous' }] : []));
    await assignAdminBooking('booking', input, actor, now);
    expect(mocks.outbox).toHaveBeenCalledWith(tx, 'push.send', containing({ userId: 'previous', category: 'JOB_WITHDRAWN' }), 'admin-booking:booking:5:withdrawn:previous');
  });
  it('offers to multiple selected drivers with the requested expiry and deduplication', async () => {
    mocks.drivers.mockResolvedValue([driver, { ...driver, userId: 'driver2' }]);
    await offerAdminBooking('booking', { expectedVersion: 4, driverIds: ['driver', 'driver2', 'driver'], expiresInMinutes: 15 }, actor, now);
    expect((mocks.create.mock.calls[0]?.[0] as { data: unknown[] }).data).toHaveLength(2);
    expect(mocks.update).toHaveBeenCalledWith(containing({ data: containing({ vanId: null, driverId: null, dispatchStatus: 'OFFERED' }) }));
  });
  it('unassigns and retains the reason and history', async () => {
    mocks.booking.mockResolvedValue({ ...current, dispatchStatus: 'ACCEPTED', driverId: 'driver', vanId: 'van' });
    await unassignAdminBooking('booking', { expectedVersion: 4, reason: 'Driver unavailable' }, actor, now);
    expect(mocks.update).toHaveBeenCalledWith(containing({ data: { driverId: null, vanId: null, dispatchStatus: 'UNASSIGNED', version: 5 } }));
    expect(mocks.audit).toHaveBeenCalledWith({ data: containing({ reason: 'Driver unavailable' }) });
  });
  it('returns real options and a capability reason for non-editable work', async () => {
    mocks.booking.mockResolvedValue({ ...current, status: 'COMPLETED', jobStage: 'COMPLETED' });
    const result = await readAdminAssignmentOptions('booking', now);
    expect(result).toMatchObject({ editable: false, reason: anyString(), drivers: [{ id: 'driver', available: true }], vans: [{ id: 'van', available: true }] });
  });
  it('rejects driver and vehicle conflicts in an additional period before a repricing preview writes anything', async () => {
    mocks.booking.mockResolvedValue({ ...current, driverId: 'driver', vanId: 'van', blocksSlots: 1 });
    const target = { moveDate: date, slot: 'MORNING' as const, blocksSlots: 2 };
    mocks.bookings.mockResolvedValue([{ driverId: 'driver', vanId: 'other', slot: 'AFTERNOON', blocksSlots: 1 }]);
    await expect(assertAdminBookingResourcesForTarget(tx as unknown as DbTx, 'booking', target, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.bookings.mockResolvedValue([{ driverId: 'other', vanId: 'van', slot: 'AFTERNOON', blocksSlots: 1 }]);
    await expect(assertAdminBookingResourcesForTarget(tx as unknown as DbTx, 'booking', target, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('driver offer acceptance', () => {
  beforeEach(() => { mocks.booking.mockResolvedValue({ ...current, dispatchStatus: 'OFFERED', vanId: 'van' }); });
  it('accepts only a current unexpired offer and reserves the checked vehicle', async () => {
    expect(await acceptAdminBookingOffer('driver', 'booking', now)).toEqual({ ok: true, id: 'booking', version: 5 });
    expect(mocks.offer).toHaveBeenCalledWith(containing({ where: containing({ expiresAt: { gt: now } }) }));
    expect(mocks.update).toHaveBeenCalledWith(containing({ where: containing({ version: 4, dispatchStatus: 'OFFERED' }), data: containing({ driverId: 'driver', vanId: 'van' }) }));
    expect(mocks.outbox).toHaveBeenCalledWith(tx, 'booking.driver_accepted', {
      bookingId: 'booking', driverId: 'driver', driverIds: ['driver'], assignmentIds: ['offer'], bookingVersion: 5,
    }, 'driver-booking:booking:5:accepted');
  });
  it('rejects an expired/withdrawn offer and rechecks conflicts before accepting', async () => {
    mocks.offer.mockResolvedValue(null);
    await expect(acceptAdminBookingOffer('driver', 'booking', now)).rejects.toMatchObject({ code: 'OFFER_TAKEN' });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.offer.mockResolvedValue({ id: 'offer' });
    mocks.bookings.mockResolvedValue([{ driverId: 'driver', vanId: null, slot: 'AFTERNOON', blocksSlots: 1 }]);
    await expect(acceptAdminBookingOffer('driver', 'booking', now)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('does not create accepted assignments if another actor wins the conditional booking update', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(acceptAdminBookingOffer('driver', 'booking', now)).rejects.toMatchObject({ code: 'OFFER_TAKEN' });
    expect(mocks.withdraw).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('returns the booking to unassigned when its last current offer is declined', async () => {
    await declineAdminBookingOffer('driver', 'booking', 'Unavailable', now);
    expect(mocks.update).toHaveBeenCalledWith(containing({ data: { dispatchStatus: 'UNASSIGNED', driverId: null, vanId: null, version: 5 } }));
    expect(mocks.outbox).toHaveBeenCalledWith(tx, 'booking.driver_declined', {
      bookingId: 'booking', driverId: 'driver', driverIds: ['driver'], assignmentIds: ['offer'], bookingVersion: 5,
    }, 'driver-booking:booking:5:declined');
  });
  it('retains other drivers current offers when one driver declines', async () => {
    mocks.count.mockResolvedValue(1);
    await declineAdminBookingOffer('driver', 'booking', undefined, now);
    expect(mocks.update).toHaveBeenCalledWith(containing({ data: containing({ dispatchStatus: 'OFFERED', vanId: 'van' }) }));
  });
});

function containing(value: unknown): unknown { return expect.objectContaining(value); }
function anyString(): unknown { return expect.any(String); }
