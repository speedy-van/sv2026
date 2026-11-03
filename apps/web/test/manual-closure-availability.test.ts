import type { DbTx, Slot } from '@sv/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closures: vi.fn(), closure: vi.fn(), overrides: vi.fn(), override: vi.fn(), rules: vi.fn(), rule: vi.fn(),
  bookings: vi.fn(), holds: vi.fn(), setting: vi.fn(), lock: vi.fn(),
}));
vi.mock('@sv/db', async () => {
  const locks = await import('../../../packages/db/src/locks');
  return { ...locks, prisma: {
    capacityClosure: { findMany: mocks.closures }, capacityOverride: { findMany: mocks.overrides },
    capacityRule: { findMany: mocks.rules }, booking: { findMany: mocks.bookings }, slotHold: { findMany: mocks.holds },
  } };
});

import { assertSlotCapacity, capacityFor, configuredCapacityFor } from '../../../packages/db/src/locks';
import { invalidateAvailabilityCache, overlayAvailability, type AvailabilityInput } from '../src/server/services/availability';

const now = new Date('2031-03-01T12:00:00.000Z');
const date = new Date('2031-03-03T00:00:00.000Z');
const tx = {
  $executeRaw: mocks.lock, capacityClosure: { findUnique: mocks.closure },
  capacityOverride: { findUnique: mocks.override }, capacityRule: { findUnique: mocks.rule },
  setting: { findUnique: mocks.setting }, booking: { findMany: mocks.bookings }, slotHold: { findMany: mocks.holds },
} as unknown as DbTx;
function input(blocksSlots = 1): AvailabilityInput {
  return {
    service: 'man-and-van', capacityUnits: 1, blocksSlots, now,
    operations: {
      slotWindows: {
        MORNING: { start: '08:00', end: '12:00', label: 'Morning' },
        AFTERNOON: { start: '12:00', end: '17:00', label: 'Afternoon' },
        EVENING: { start: '17:00', end: '21:00', label: 'Evening' },
      },
      minLeadMinutes: 0, defaultCapacityPerSlot: 7, serviceAreaRule: 'SCOTLAND_ONLY', crossBorderMoves: false,
      maxInstantDistanceMiles: 100, quoteValidityMinutes: 60, paymentHoldMinutes: 15,
      phoneBookingHoldHours: 24, bookingPaused: false, jobSizeRules: [],
    },
    calendar: [{ date: '2031-03-03', dayOffset: 2, weekday: 1, slots: (['MORNING', 'AFTERNOON', 'EVENING'] as const).map((slot) => ({
      slot, pricePence: 10000, multipliers: { urgency: 1, weekend: 1, peakMonth: 1, endOfMonth: 1, slot: 1 },
    })) }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  invalidateAvailabilityCache();
  mocks.closures.mockResolvedValue([]);
  mocks.closure.mockResolvedValue(null);
  mocks.overrides.mockResolvedValue([]);
  mocks.override.mockResolvedValue({ capacity: 7 });
  mocks.rules.mockResolvedValue([]);
  mocks.rule.mockResolvedValue(null);
  mocks.setting.mockResolvedValue({ value: { defaultCapacityPerSlot: 7 } });
  mocks.bookings.mockResolvedValue([]);
  mocks.holds.mockResolvedValue([]);
});

describe('manual closures reach quote calendars and final locked booking checks', () => {
  it('shows CLOSED rather than inventing booked usage or changing quoted prices', async () => {
    mocks.closures.mockResolvedValue([{ date, slot: 'AFTERNOON' }]);
    const result = await overlayAvailability(input());
    expect(result.calendar[0]?.slots.map((slot) => ({ slot: slot.slot, available: slot.available, reason: slot.reason, pricePence: slot.pricePence }))).toEqual([
      { slot: 'MORNING', available: true, reason: undefined, pricePence: 10000 },
      { slot: 'AFTERNOON', available: false, reason: 'CLOSED', pricePence: 10000 },
      { slot: 'EVENING', available: true, reason: undefined, pricePence: 10000 },
    ]);
    expect(result.slotsOpen).toBe(2);
  });

  it('blocks a multi-period quote if any covered period is manually closed', async () => {
    mocks.closures.mockResolvedValue([{ date, slot: 'AFTERNOON' }]);
    const result = await overlayAvailability(input(2));
    expect(result.calendar[0]?.slots[0]).toMatchObject({ slot: 'MORNING', available: false, reason: 'CLOSED' });
    expect(result.calendar[0]?.slots[1]).toMatchObject({ slot: 'AFTERNOON', available: false, reason: 'CLOSED' });
  });

  it('returns zero effective capacity while preserving the configured override for reopening', async () => {
    mocks.closure.mockResolvedValue({ id: 'closure-unit' });
    expect(await capacityFor(tx, date, 'MORNING')).toBe(0);
    expect(mocks.override).not.toHaveBeenCalled();
    expect(await configuredCapacityFor(tx, date, 'MORNING')).toBe(7);
    mocks.closure.mockResolvedValue(null);
    expect(await capacityFor(tx, date, 'MORNING')).toBe(7);
  });

  it('rejects a stale client selection under the real slot lock even when usage is zero', async () => {
    mocks.closure.mockResolvedValue({ id: 'closure-unit' });
    await expect(assertSlotCapacity(tx, { moveDate: date, slot: 'MORNING', now })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.closure.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('locks a multi-period request in order and rejects a closure in a later covered slot', async () => {
    mocks.closure.mockImplementation(({ where }: { where: { date_slot: { slot: Slot } } }) => Promise.resolve(where.date_slot.slot === 'AFTERNOON' ? { id: 'closure-unit' } : null));
    await expect(assertSlotCapacity(tx, { moveDate: date, slot: 'MORNING', blocksSlots: 2, now })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(mocks.lock.mock.calls.map((call): unknown => call[1])).toEqual(['slot:2031-03-03:MORNING', 'slot:2031-03-03:AFTERNOON']);
  });

  it('invalidates a warm quote cache immediately when a manual closure changes', async () => {
    expect((await overlayAvailability(input())).slotsOpen).toBe(3);
    mocks.closures.mockResolvedValue([{ date, slot: 'AFTERNOON' }]);
    invalidateAvailabilityCache();
    expect((await overlayAvailability(input())).calendar[0]?.slots[1]).toMatchObject({ available: false, reason: 'CLOSED' });
    mocks.closures.mockResolvedValue([]);
    invalidateAvailabilityCache();
    expect((await overlayAvailability(input())).slotsOpen).toBe(3);
  });

  it('does not let an older in-flight capacity read repopulate a newly invalidated cache', async () => {
    let resolveOld: ((rows: { date: Date; slot: Slot }[]) => void) | undefined;
    mocks.closures.mockImplementationOnce(() => new Promise<{ date: Date; slot: Slot }[]>((resolve) => { resolveOld = resolve; }));
    const old = overlayAvailability(input());
    invalidateAvailabilityCache();
    mocks.closures.mockResolvedValue([{ date, slot: 'AFTERNOON' }]);
    expect((await overlayAvailability(input())).slotsOpen).toBe(2);
    if (!resolveOld) throw new Error('Expected the older mocked capacity read to be pending.');
    resolveOld([]);
    await old;
    expect((await overlayAvailability(input())).slotsOpen).toBe(2);
    expect(mocks.closures).toHaveBeenCalledTimes(2);
  });
});
