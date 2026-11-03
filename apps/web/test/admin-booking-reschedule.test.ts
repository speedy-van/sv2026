import { AppError, BookingPricingInputSchema, BookingStoredPriceSchema } from '@sv/contracts';
import { DEFAULT_PRICING_CONFIG, priceForSlot, type PricingInput } from '@sv/pricing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), booking: vi.fn(), bookings: vi.fn(), holds: vi.fn(), rules: vi.fn(), overrides: vi.fn(), closures: vi.fn(),
  update: vi.fn(), audit: vi.fn(), capacity: vi.fn(), ready: vi.fn(), settle: vi.fn(), withdraw: vi.fn(), outbox: vi.fn(), active: vi.fn(), operations: vi.fn(), invalidated: vi.fn() }));
vi.mock('@sv/db', async () => ({ ...await import('../../../packages/db/src/locks'), prisma: {
  $transaction: mocks.transaction, booking: { findUnique: mocks.booking },
}, enqueueOutbox: mocks.outbox }));
vi.mock('../src/server/admin/booking-capacity', () => ({ assertAdminBookingCapacity: mocks.capacity }));
vi.mock('../src/server/admin/booking-change-guards', () => ({ assertAdminBookingChangeReady: mocks.ready }));
vi.mock('../src/server/admin/booking-settlement', () => ({
  settleAdminBookingChange: mocks.settle,
  previewAdminBookingSettlement: (_tx: unknown, booking: { totalPence: number; paidPence: number; refundedPence: number }, total: number) => {
    const balance = total === booking.totalPence ? 0 : total - booking.paidPence + booking.refundedPence;
    return { settle: balance > 0 ? 'EXTRA_CHARGE' : balance < 0 ? 'REFUND' : 'NONE', settlementAmountPence: Math.abs(balance) };
  },
}));
vi.mock('../src/server/admin/booking-dispatch', () => ({ withdrawAdminBookingAssignments: mocks.withdraw }));
vi.mock('../src/server/admin/booking-edit-pricing', async () => {
  const { BookingPricingInputSchema } = await import('@sv/contracts');
  return { parseBookingPricingInput: (value: unknown) => BookingPricingInputSchema.parse(value) };
});
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: mocks.active }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: mocks.operations }));
vi.mock('../src/server/services/availability', () => ({ invalidateAvailabilityCache: mocks.invalidated }));
import { previewAdminReschedule, readAdminBookingCalendar, rescheduleAdminBooking } from '../src/server/admin/booking-reschedule';

const now = new Date('2031-03-01T10:00:00Z');
const actor = { userId: 'admin', requestId: 'request', role: 'ADMIN' as const };
const original: PricingInput = BookingPricingInputSchema.parse({ service: 'man-and-van', variant: 'standard', distanceMiles: 12,
  pickup: { floor: 0, hasLift: false }, dropoff: { floor: 0, hasLift: false }, inventory: [{ itemId: 'chair', name: 'Chair', quantity: 2, unitVolumeM3: 0.5 }],
  access: { carryMetres: 0, narrowAccess: false, permitZone: false }, addons: { helpers: 0, packing: false, assembly: false } });
const originalPrice = priceForSlot(original, DEFAULT_PRICING_CONFIG, '2031-03-01', '2031-03-03', 'MORNING');
const current = { id: 'booking', reference: 'SV-BOOK01', version: 3, deletedAt: null, status: 'CONFIRMED', jobStage: 'NOT_STARTED',
  dispatchStatus: 'ACCEPTED', driverId: 'driver', vanId: 'van', moveDate: new Date('2031-03-03T00:00:00Z'), slot: 'MORNING', blocksSlots: 2, capacityUnits: 1,
  service: original.service, source: 'WEB', pricingInput: original, pricingVersionId: 'old-pricing',
  priceBreakdown: { breakdown: originalPrice.breakdown, slot: { date: '2031-03-03', slot: 'MORNING', multipliers: originalPrice.multipliers } },
  totalPence: 10000, paidPence: 10000, refundedPence: 0 };
const input = { expectedVersion: 3, date: '2031-03-04', slot: 'MORNING' as const, priceMode: 'KEEP_PRICE' as const, reason: 'Customer requested another day' };
const operations = { minLeadMinutes: 60, defaultCapacityPerSlot: 1, slotWindows: {
  MORNING: { start: '08:00', end: '12:00', label: 'Morning' }, AFTERNOON: { start: '12:00', end: '17:00', label: 'Afternoon' }, EVENING: { start: '17:00', end: '21:00', label: 'Evening' },
} };
const tx = { booking: { findUnique: mocks.booking, findMany: mocks.bookings, updateMany: mocks.update }, slotHold: { findMany: mocks.holds },
  capacityOverride: { findMany: mocks.overrides }, capacityRule: { findMany: mocks.rules }, capacityClosure: { findMany: mocks.closures }, auditLog: { create: mocks.audit } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  mocks.booking.mockResolvedValue({ ...current }); mocks.update.mockResolvedValue({ count: 1 });
  mocks.active.mockResolvedValue({ config: DEFAULT_PRICING_CONFIG, id: 'active-pricing', version: 2 }); mocks.operations.mockResolvedValue(operations);
  for (const mock of [mocks.bookings, mocks.holds, mocks.rules, mocks.overrides, mocks.closures]) mock.mockResolvedValue([]);
});

describe('admin reschedule preview and mutation', () => {
  it('previews KEEP_PRICE without repricing or writing anything', async () => {
    expect(await previewAdminReschedule('booking', input, actor, now)).toMatchObject({ id: 'booking', expectedVersion: 3, currentTotalPence: 10000,
      newTotalPence: 10000, differencePence: 0, settle: 'NONE', settlementAmountPence: 0, willUnassignDriver: true });
    expect(mocks.active).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
    expect(mocks.capacity).toHaveBeenCalledWith(tx, current, containing({ moveDate: new Date('2031-03-04T00:00:00Z'), blocksSlots: 2 }), containing({ actorRole: 'ADMIN' }));
  });
  it('recomputes NEW_PRICE using the active engine config and original input', async () => {
    const expected = priceForSlot(original, DEFAULT_PRICING_CONFIG, '2031-03-01', input.date, input.slot);
    const preview = await previewAdminReschedule('booking', { ...input, priceMode: 'NEW_PRICE' }, actor, now);
    expect(preview.newTotalPence).toBe(expected.pricePence); expect(preview.differencePence).toBe(expected.pricePence - 10000);
  });
  it('applies the move with version guard, preserves KEEP_PRICE, withdraws work and records transaction effects', async () => {
    expect(await rescheduleAdminBooking('booking', { ...input, expectedTotalPence: 10000, expectedSettlementPence: 0, settle: 'NONE' }, actor, now)).toEqual({ ok: true, id: 'booking', version: 4 });
    expect(mocks.update).toHaveBeenCalledWith(containing({ where: containing({ version: 3, status: 'CONFIRMED', jobStage: 'NOT_STARTED' }),
      data: containing({ moveDate: new Date('2031-03-04T00:00:00Z'), totalPence: 10000, priceBreakdown: current.priceBreakdown, pricingVersionId: 'old-pricing', driverId: null, vanId: null, dispatchStatus: 'UNASSIGNED', reminderSentAt: null }) }));
    expect(mocks.withdraw).toHaveBeenCalledWith(tx, current, [], now, 'driver');
    expect(mocks.audit).toHaveBeenCalledOnce(); expect(mocks.invalidated).toHaveBeenCalledOnce();
    expect(mocks.outbox).toHaveBeenCalledWith(tx, 'booking.rescheduled', { bookingId: 'booking', previousDriverId: 'driver' }, 'admin-booking:booking:4:rescheduled');
  });
  it('stores a complete engine breakdown and slot snapshot for later repricing', async () => {
    const preview = await previewAdminReschedule('booking', { ...input, priceMode: 'NEW_PRICE' }, actor, now);
    await rescheduleAdminBooking('booking', { ...input, priceMode: 'NEW_PRICE', expectedTotalPence: preview.newTotalPence, expectedSettlementPence: preview.settlementAmountPence, settle: preview.settle }, actor, now);
    const update = mocks.update.mock.calls[0]?.[0] as { data: { priceBreakdown: unknown; pricingVersionId: string } };
    expect(BookingStoredPriceSchema.parse(update.data.priceBreakdown).slot).toMatchObject({ date: input.date, slot: input.slot });
    expect(update.data.pricingVersionId).toBe('active-pricing');
    expect(mocks.settle).toHaveBeenCalledWith(tx, current, containing({ newTotalPence: preview.newTotalPence, expectedSettlementPence: preview.settlementAmountPence, settle: preview.settle }), now);
  });
  it('rejects stale version, changed prices and payment changes without enqueuing effects', async () => {
    await expect(rescheduleAdminBooking('booking', { ...input, expectedVersion: 2, expectedTotalPence: 10000, expectedSettlementPence: 0, settle: 'NONE' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(rescheduleAdminBooking('booking', { ...input, expectedTotalPence: 9999, expectedSettlementPence: 0, settle: 'NONE' }, actor, now)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    mocks.ready.mockRejectedValue(new AppError('CONFLICT', 'Payment processing'));
    await expect(previewAdminReschedule('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('rejects unavailable capacity instead of returning false success', async () => {
    mocks.capacity.mockRejectedValue(new AppError('SLOT_UNAVAILABLE', 'Taken'));
    await expect(rescheduleAdminBooking('booking', { ...input, expectedTotalPence: 10000, expectedSettlementPence: 0, settle: 'NONE' }, actor, now)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([{ status: 'IN_PROGRESS' }, { jobStage: 'LOADING' }, { deletedAt: now }, { status: 'CANCELLED' }])('rejects non-editable booking %#', async (override) => {
    mocks.booking.mockResolvedValue({ ...current, ...override });
    await expect(previewAdminReschedule('booking', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('enforces London cutoff in summer and refuses past dates even with owner override', async () => {
    const summerNow = new Date('2031-07-01T06:01:00Z'); // 07:01 London, after the 07:00 cutoff.
    await expect(previewAdminReschedule('booking', { ...input, date: '2031-07-01', overrideCapacity: true }, { ...actor, role: 'OWNER' }, summerNow)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    await expect(previewAdminReschedule('booking', { ...input, date: '2031-02-28' }, actor, now)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });
  it('allows KEEP_PRICE for older incomplete pricing snapshots but refuses a new invented price', async () => {
    mocks.booking.mockResolvedValue({ ...current, pricingInput: {} });
    await expect(previewAdminReschedule('booking', input, actor, now)).resolves.toMatchObject({ newTotalPence: 10000 });
    await expect(previewAdminReschedule('booking', { ...input, priceMode: 'NEW_PRICE' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it.each([{ source: 'MANUAL_QUOTE' }, { priceBreakdown: { manual: true, pricePence: 10000 } }])('keeps manual agreements intact unless their price is explicitly preserved %#', async (override) => {
    mocks.booking.mockResolvedValue({ ...current, ...override });
    await expect(previewAdminReschedule('booking', { ...input, priceMode: 'NEW_PRICE' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(rescheduleAdminBooking('booking', { ...input, priceMode: 'NEW_PRICE', expectedTotalPence: 10000, expectedSettlementPence: 0, settle: 'NONE' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(previewAdminReschedule('booking', input, actor, now)).resolves.toMatchObject({ newTotalPence: 10000, settle: 'NONE' });
  });
});

it('returns real capacity across every covered period and excludes its own existing reservation', async () => {
  mocks.bookings.mockResolvedValue([{ moveDate: new Date('2031-03-04T00:00:00Z'), slot: 'AFTERNOON', blocksSlots: 1, capacityUnits: 1 }]);
  mocks.closures.mockResolvedValue([{ date: new Date('2031-03-05T00:00:00Z'), slot: 'MORNING' }]);
  const calendar = await readAdminBookingCalendar('booking', now);
  expect(calendar.days.find((day) => day.date === '2031-03-03')?.slots[0]).toMatchObject({ current: true, available: true });
  expect(calendar.days.find((day) => day.date === '2031-03-04')?.slots[0]).toMatchObject({ available: false, reason: 'This period is full.' });
  expect(calendar.days.find((day) => day.date === '2031-03-05')?.slots[0]).toMatchObject({ available: false, reason: 'This period is closed.' });
  expect(mocks.bookings).toHaveBeenCalledWith(containing({ where: containing({ id: { not: 'booking' } }) }));
});

it('keeps already reserved portions selectable when a partially overlapping move adds capacity only elsewhere', async () => {
  mocks.closures.mockResolvedValue([{ date: current.moveDate, slot: 'AFTERNOON' }]);
  const calendar = await readAdminBookingCalendar('booking', now);
  const day = calendar.days.find((entry) => entry.date === '2031-03-03');
  expect(day?.slots.find((entry) => entry.slot === 'MORNING')).toMatchObject({ available: true, current: true });
  expect(day?.slots.find((entry) => entry.slot === 'AFTERNOON')).toMatchObject({ available: true, current: false });
});

function containing(value: unknown): unknown { return expect.objectContaining(value); }
