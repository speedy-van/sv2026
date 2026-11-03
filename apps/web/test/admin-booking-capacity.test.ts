import { AppError } from '@sv/contracts';
import type { DbTx } from '@sv/db';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lock: vi.fn(), used: vi.fn(), capacity: vi.fn(), closure: vi.fn() }));
vi.mock('@sv/db', async () => {
  const actual = await import('../../../packages/db/src/locks');
  return { ...actual, lockSlot: mocks.lock, countSlotUsage: mocks.used, capacityFor: mocks.capacity };
});
import { assertAdminBookingCapacity } from '../src/server/admin/booking-capacity';
const tx = { capacityClosure: { findUnique: mocks.closure } } as unknown as DbTx;
const now = new Date('2031-01-01T00:00:00Z');
const current = { id: 'booking', moveDate: new Date('2031-01-03T00:00:00Z'), slot: 'MORNING' as const, blocksSlots: 2, capacityUnits: 1 };
beforeEach(() => { vi.resetAllMocks(); mocks.used.mockResolvedValue(1); mocks.capacity.mockResolvedValue(1); mocks.closure.mockResolvedValue(null); });

it('excludes the existing multi-period booking from overlapping target usage', async () => {
  mocks.used.mockImplementation((_tx, _date, slot: string) => Promise.resolve(slot === 'EVENING' ? 0 : 1));
  await assertAdminBookingCapacity(tx, current, { ...current, slot: 'AFTERNOON' }, { now, actorRole: 'ADMIN' });
  expect(mocks.lock.mock.calls.map((call) => call[2] as unknown)).toEqual(['MORNING', 'AFTERNOON', 'EVENING']);
});
it('locks old and new dates in chronological order even when moving earlier', async () => {
  mocks.used.mockResolvedValue(0);
  const date = new Date('2031-01-02T00:00:00Z');
  await assertAdminBookingCapacity(tx, current, { ...current, moveDate: date, blocksSlots: 1 }, { now, actorRole: 'ADMIN' });
  expect(mocks.lock.mock.calls.map((call) => [call[1] as unknown, call[2] as unknown])).toEqual([[date, 'MORNING'], [current.moveDate, 'MORNING'], [current.moveDate, 'AFTERNOON']]);
});
it('rejects capacity taken by another job in any covered period', async () => {
  mocks.used.mockResolvedValue(2);
  await expect(assertAdminBookingCapacity(tx, current, { ...current, capacityUnits: 2 }, { now, actorRole: 'ADMIN' })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
});
it('permits only the owner to override numeric capacity', async () => {
  mocks.used.mockResolvedValue(20);
  await expect(assertAdminBookingCapacity(tx, current, current, { now, actorRole: 'ADMIN', overrideCapacity: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(assertAdminBookingCapacity(tx, current, { ...current, capacityUnits: 2 }, { now, actorRole: 'OWNER', overrideCapacity: true })).resolves.toBeUndefined();
});
it('never overrides a manual closure or an impossible multi-period range', async () => {
  mocks.closure.mockResolvedValue({ id: 'closure' });
  await expect(assertAdminBookingCapacity(tx, current, { ...current, capacityUnits: 2 }, { now, actorRole: 'OWNER', overrideCapacity: true })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  mocks.closure.mockResolvedValue(null);
  await expect(assertAdminBookingCapacity(tx, current, { ...current, slot: 'EVENING' }, { now, actorRole: 'OWNER', overrideCapacity: true })).rejects.toBeInstanceOf(AppError);
});
it('allows unchanged and reduced reservations after a period is closed or over capacity', async () => {
  mocks.closure.mockResolvedValue({ id: 'closure' }); mocks.used.mockResolvedValue(5); mocks.capacity.mockResolvedValue(0);
  await expect(assertAdminBookingCapacity(tx, current, current, { now, actorRole: 'ADMIN' })).resolves.toBeUndefined();
  await expect(assertAdminBookingCapacity(tx, { ...current, capacityUnits: 2 }, { ...current, blocksSlots: 1 }, { now, actorRole: 'ADMIN' })).resolves.toBeUndefined();
  expect(mocks.closure).not.toHaveBeenCalled(); expect(mocks.used).not.toHaveBeenCalled();
});
it('only checks the added period when shifting an overlapping reservation', async () => {
  mocks.closure.mockImplementation((query: { where: { date_slot: { slot: string } } }) => Promise.resolve(query.where.date_slot.slot === 'AFTERNOON' ? { id: 'closed-existing-period' } : null));
  mocks.used.mockResolvedValue(0);
  await expect(assertAdminBookingCapacity(tx, current, { ...current, slot: 'AFTERNOON' }, { now, actorRole: 'ADMIN' })).resolves.toBeUndefined();
  expect(mocks.closure).toHaveBeenCalledExactlyOnceWith({ where: { date_slot: { date: current.moveDate, slot: 'EVENING' } }, select: { id: true } });
});
