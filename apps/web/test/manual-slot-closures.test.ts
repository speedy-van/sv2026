import { AppError, type AdminSlotClosureRequest } from '@sv/contracts';
import type { Slot } from '@sv/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closureFindMany: vi.fn(), closureFindUnique: vi.fn(), closureCreate: vi.fn(), closureDeleteMany: vi.fn(),
  bookingFindMany: vi.fn(), holdFindMany: vi.fn(), paymentFindMany: vi.fn(), overrideFindMany: vi.fn(),
  ruleFindMany: vi.fn(), settingFindUnique: vi.fn(), auditCreate: vi.fn(), lock: vi.fn(), transaction: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@sv/db', async () => {
  const locks = await import('../../../packages/db/src/locks');
  return { ...locks, prisma: { $transaction: mocks.transaction } };
});
vi.mock('../src/server/services/availability', () => ({ invalidateAvailabilityCache: mocks.invalidate }));

import { readAdminScheduleWindows, setAdminSlotClosure } from '../src/server/admin/slot-closure';

const now = new Date('2031-03-01T12:00:00.000Z');
const moveDate = new Date('2031-03-03T00:00:00.000Z');
const future = new Date(now.getTime() + 900_000);
const past = new Date(now.getTime() - 1000);
const staff = { userId: 'admin-unit', requestId: 'request-unit' };
interface Closure { id: string; date: Date; slot: Slot; reason: string; createdById: string; createdAt: Date }
interface Booking {
  slot: Slot; blocksSlots: number; capacityUnits: number; status: string; holdExpiresAt: Date | null;
  payments: { status: string; kind: string }[];
}
interface Hold { slot: Slot; blocksSlots: number; capacityUnits: number; expiresAt: Date; paymentId: string | null }
let closure: Closure | null;
let bookings: Booking[];
let holds: Hold[];
const tx = {
  $executeRaw: mocks.lock,
  capacityClosure: { findMany: mocks.closureFindMany, findUnique: mocks.closureFindUnique, create: mocks.closureCreate, deleteMany: mocks.closureDeleteMany },
  booking: { findMany: mocks.bookingFindMany }, slotHold: { findMany: mocks.holdFindMany }, payment: { findMany: mocks.paymentFindMany },
  capacityOverride: { findMany: mocks.overrideFindMany }, capacityRule: { findMany: mocks.ruleFindMany },
  setting: { findUnique: mocks.settingFindUnique }, auditLog: { create: mocks.auditCreate },
};
type Tx = Parameters<typeof readAdminScheduleWindows>[0];
const dbTx = tx as unknown as Tx;
function input(overrides: Partial<AdminSlotClosureRequest> = {}): AdminSlotClosureRequest {
  return { date: '2031-03-03', slot: 'MORNING', closed: true, expectedClosureId: null, reason: 'Owner requested no further reservations.', ...overrides };
}
function heldBooking(overrides: Partial<Booking> = {}): Booking {
  return { slot: 'MORNING', blocksSlots: 1, capacityUnits: 1, status: 'PENDING_PAYMENT', holdExpiresAt: future, payments: [], ...overrides };
}
function existingClosure(overrides: Partial<Closure> = {}): Closure {
  return { id: 'closure-existing', date: moveDate, slot: 'MORNING', reason: 'Existing manual closure', createdById: staff.userId, createdAt: past, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  closure = null;
  bookings = [];
  holds = [];
  mocks.closureFindMany.mockImplementation(() => Promise.resolve(closure ? [closure] : []));
  mocks.closureFindUnique.mockImplementation(() => Promise.resolve(closure ? { id: closure.id } : null));
  mocks.closureCreate.mockImplementation(({ data }: { data: Omit<Closure, 'id'> }) => {
    closure = { id: 'closure-created', ...data };
    return Promise.resolve({ id: closure.id });
  });
  mocks.closureDeleteMany.mockImplementation(({ where }: { where: { id: string } }) => {
    if (closure?.id !== where.id) return Promise.resolve({ count: 0 });
    closure = null;
    return Promise.resolve({ count: 1 });
  });
  mocks.bookingFindMany.mockImplementation(({ select }: { select: { status?: boolean } }) => Promise.resolve(select.status ? bookings
    : bookings.filter((booking) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status)
      || (booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt && booking.holdExpiresAt > now))));
  mocks.holdFindMany.mockImplementation(({ where }: { where: { expiresAt?: { gt: Date } } }) => Promise.resolve(where.expiresAt ? holds.filter((hold) => hold.expiresAt > now) : holds));
  mocks.paymentFindMany.mockResolvedValue([]);
  mocks.overrideFindMany.mockResolvedValue(['MORNING', 'AFTERNOON', 'EVENING'].map((slot) => ({ slot, capacity: 7 })));
  mocks.ruleFindMany.mockResolvedValue(['MORNING', 'AFTERNOON', 'EVENING'].map((slot) => ({ slot, capacity: 3 })));
  mocks.settingFindUnique.mockResolvedValue({ value: { defaultCapacityPerSlot: 2 } });
  mocks.transaction.mockImplementation(async (operation: (client: typeof dbTx) => Promise<unknown>) => {
    const previous = closure;
    try { return await operation(dbTx); } catch (error) { closure = previous; throw error; }
  });
});

describe('manual schedule closures preserve configuration and existing reservations', () => {
  it('preserves zero overrides, weekly precedence and the persisted default with a bounded day read', async () => {
    mocks.overrideFindMany.mockResolvedValue([{ slot: 'MORNING', capacity: 0 }]);
    mocks.ruleFindMany.mockResolvedValue([{ slot: 'MORNING', capacity: 9 }, { slot: 'AFTERNOON', capacity: 4 }]);
    const windows = await readAdminScheduleWindows(dbTx, moveDate, now);
    expect(windows.map((window) => window.configuredCapacity)).toEqual([0, 4, 2]);
    for (const query of [mocks.closureFindMany, mocks.bookingFindMany, mocks.holdFindMany, mocks.overrideFindMany, mocks.ruleFindMany, mocks.settingFindUnique])
      expect(query).toHaveBeenCalledOnce();
    expect(mocks.ruleFindMany).toHaveBeenCalledWith({ where: { weekday: moveDate.getUTCDay(), slot: { in: ['MORNING', 'AFTERNOON', 'EVENING'] } }, select: { slot: true, capacity: true } });
    expect(mocks.paymentFindMany).not.toHaveBeenCalled();
  });

  it('matches the booking capacity authority for all statuses, expiry boundaries and overlapping holds', async () => {
    const { countSlotUsage } = await import('../../../packages/db/src/locks');
    bookings = [
      heldBooking({ status: 'CONFIRMED', holdExpiresAt: null, blocksSlots: 3, capacityUnits: 2 }),
      heldBooking({ status: 'IN_PROGRESS', slot: 'AFTERNOON', holdExpiresAt: null }),
      heldBooking({ status: 'COMPLETED', slot: 'EVENING', holdExpiresAt: null }),
      heldBooking({ blocksSlots: 2, capacityUnits: 3 }),
      heldBooking({ holdExpiresAt: now, capacityUnits: 50 }),
      heldBooking({ holdExpiresAt: past, payments: [{ kind: 'BOOKING', status: 'SUCCEEDED' }], capacityUnits: 50 }),
      heldBooking({ status: 'CANCELLED', payments: [{ kind: 'BOOKING', status: 'PROCESSING' }], capacityUnits: 50 }),
      heldBooking({ status: 'EXPIRED', holdExpiresAt: past, capacityUnits: 50 }),
    ];
    holds = [
      { slot: 'AFTERNOON', blocksSlots: 2, capacityUnits: 4, expiresAt: future, paymentId: null },
      { slot: 'MORNING', blocksSlots: 3, capacityUnits: 50, expiresAt: now, paymentId: null },
    ];
    const windows = await readAdminScheduleWindows(dbTx, moveDate, now);
    const authoritative = await Promise.all(windows.map((window) => countSlotUsage(dbTx, moveDate, window.slot, now)));
    expect(authoritative).toEqual([5, 10, 7]);
    expect(windows.map((window) => window.confirmedUnits + window.heldUnits)).toEqual(authoritative);
    expect(windows.map((window) => window.heldUnits)).toEqual([3, 7, 4]);
    expect(windows.map((window) => window.availableUnits)).toEqual([2, 0, 0]);
  });

  it('closes only the requested period under the same lock as booking creation, with a full authoritative acknowledgement', async () => {
    bookings = [heldBooking({ status: 'CONFIRMED', holdExpiresAt: null, capacityUnits: 2 })];
    const result = await setAdminSlotClosure(input(), staff, now);
    expect(result).toMatchObject({ date: '2031-03-03', generatedAt: now.toISOString(), window: {
      slot: 'MORNING', configuredCapacity: 7, capacity: 0, confirmedUnits: 2, heldUnits: 0, availableUnits: 0,
      manualClosure: { id: 'closure-created', reason: input().reason }, closeAllowed: true,
    } });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.closureFindUnique.mock.invocationCallOrder[0] ?? Infinity);
    expect(mocks.closureCreate.mock.calls[0]?.[0]).toMatchObject({ data: { date: moveDate, slot: 'MORNING', createdById: staff.userId, reason: input().reason } });
    expect(mocks.auditCreate.mock.calls[0]?.[0]).toMatchObject({ data: { action: 'admin.capacity.closures.put', actorUserId: staff.userId, requestId: staff.requestId, reason: input().reason } });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidate.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('reopening removes only its closure and restores the pre-existing positive date override', async () => {
    closure = existingClosure();
    const result = await setAdminSlotClosure(input({ closed: false, expectedClosureId: closure.id, reason: 'Reopen for new reservations.' }), staff, now);
    expect(result.window).toMatchObject({ configuredCapacity: 7, capacity: 7, availableUnits: 7, manualClosure: null });
    expect(mocks.closureDeleteMany.mock.calls[0]?.[0]).toEqual({ where: { id: 'closure-existing', date: moveDate, slot: 'MORNING' } });
    expect(mocks.closureCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    // The mock deliberately exposes no override/rule mutations or booking/payment writes.
  });

  it('reopening can truthfully remain closed when the underlying capacity configuration is zero', async () => {
    closure = existingClosure();
    mocks.overrideFindMany.mockResolvedValue([{ slot: 'MORNING', capacity: 0 }]);
    const result = await setAdminSlotClosure(input({ closed: false, expectedClosureId: closure.id }), staff, now);
    expect(result.window).toMatchObject({ capacity: 0, configuredCapacity: 0, manualClosure: null, closeAllowed: false });
  });

  it('reads weekly/default capacity without freezing either into a new date override', async () => {
    mocks.overrideFindMany.mockResolvedValue([]);
    const [weekly] = await readAdminScheduleWindows(dbTx, moveDate, now, ['MORNING']);
    expect(weekly?.configuredCapacity).toBe(3);
    mocks.ruleFindMany.mockResolvedValue([]);
    const [fallback] = await readAdminScheduleWindows(dbTx, moveDate, now, ['MORNING']);
    expect(fallback?.configuredCapacity).toBe(2);
  });

  it.each(['checkout', 'reschedule'] as const)('blocks a %s hold spanning into the requested period', async (kind) => {
    if (kind === 'checkout') bookings = [heldBooking({ blocksSlots: 2, capacityUnits: 2 })];
    else holds = [{ slot: 'MORNING', blocksSlots: 2, capacityUnits: 2, expiresAt: future, paymentId: 'payment-unit' }];
    await expect(setAdminSlotClosure(input({ slot: 'AFTERNOON' }), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.closureCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    const windows = await readAdminScheduleWindows(dbTx, moveDate, now);
    expect(windows.map((window) => window.heldUnits)).toEqual([2, 2, 0]);
    expect(windows.map((window) => window.closeAllowed)).toEqual([false, false, true]);
  });

  it.each([
    ['PENDING_PAYMENT', 'BOOKING', 'PROCESSING'], ['PENDING_PAYMENT', 'ADMIN_BOOKING', 'SUCCEEDED'],
    ['PENDING_PAYMENT', 'MANUAL_QUOTE', 'SUCCEEDED'], ['COMPLETED', 'EXTRA_CHARGE', 'PROCESSING'],
  ])('blocks unresolved %s %s %s even after its ordinary hold expires', async (status, kind, paymentStatus) => {
    bookings = [heldBooking({ status, holdExpiresAt: past, payments: [{ kind, status: paymentStatus }] })];
    await expect(setAdminSlotClosure(input(), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.closureCreate).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'SUCCEEDED'])('blocks an expired reschedule hold awaiting %s reconciliation', async () => {
    holds = [{ slot: 'MORNING', blocksSlots: 2, capacityUnits: 1, expiresAt: past, paymentId: 'payment-unit' }];
    mocks.paymentFindMany.mockResolvedValue([{ id: 'payment-unit' }]);
    await expect(setAdminSlotClosure(input({ slot: 'AFTERNOON' }), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.paymentFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: { in: ['payment-unit'] }, status: { in: ['PROCESSING', 'SUCCEEDED'] } } });
  });

  it('does not confuse fully paid confirmed work or expired unpaid holds with a live checkout', async () => {
    bookings = [heldBooking({ status: 'CONFIRMED', holdExpiresAt: null, payments: [{ kind: 'BOOKING', status: 'SUCCEEDED' }] })];
    holds = [{ slot: 'MORNING', blocksSlots: 1, capacityUnits: 1, expiresAt: past, paymentId: 'payment-unit' }];
    const result = await setAdminSlotClosure(input(), staff, now);
    expect(result.window).toMatchObject({ capacity: 0, confirmedUnits: 1, heldUnits: 0, manualClosure: { id: 'closure-created' } });
  });

  it('is idempotent for same-state requests without overwriting another closure reason or writing duplicate audits', async () => {
    closure = existingClosure();
    const closed = await setAdminSlotClosure(input(), staff, now);
    expect(closed.window.manualClosure?.reason).toBe('Existing manual closure');
    expect(mocks.closureCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    closure = null;
    const open = await setAdminSlotClosure(input({ closed: false, expectedClosureId: 'old-closure' }), staff, now);
    expect(open.window.manualClosure).toBeNull();
    expect(mocks.closureDeleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('requires the exact closure identity to reopen and rejects a stale close after another admin reopened', async () => {
    closure = existingClosure();
    await expect(setAdminSlotClosure(input({ closed: false, expectedClosureId: 'different-closure' }), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    closure = null;
    await expect(setAdminSlotClosure(input({ expectedClosureId: 'old-closure' }), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.closureCreate).not.toHaveBeenCalled();
    expect(mocks.closureDeleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('still permits reopening when a reservation now overlaps the manually closed period', async () => {
    closure = existingClosure();
    bookings = [heldBooking()];
    const result = await setAdminSlotClosure(input({ closed: false, expectedClosureId: closure.id }), staff, now);
    expect(result.window).toMatchObject({ manualClosure: null, heldUnits: 1, availableUnits: 6, closeAllowed: false });
  });

  it('observes a reservation committed before the slot lock was acquired and fails closed', async () => {
    mocks.lock.mockImplementation(() => { bookings = [heldBooking()]; return Promise.resolve(1); });
    await expect(setAdminSlotClosure(input(), staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.closureCreate).not.toHaveBeenCalled();
  });

  it('rolls back the closure when its transactional audit fails and never invalidates as success', async () => {
    mocks.auditCreate.mockRejectedValue(new AppError('INTERNAL', 'Unit test audit failure'));
    await expect(setAdminSlotClosure(input(), staff, now)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(closure).toBeNull();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
