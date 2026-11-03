import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, QuoteRequestSchema, RepriceApplySchema } from '@sv/contracts';
import { DEFAULT_PRICING_CONFIG, priceForSlot, SERVICE_KEYS, type PricingInput } from '@sv/pricing';
import type { DbTx } from '@sv/db';

const mocks = vi.hoisted(() => ({
  booking: vi.fn(), update: vi.fn(), transaction: vi.fn(), audit: vi.fn(), outbox: vi.fn(),
  paymentCount: vi.fn(), refundCount: vi.fn(), extraCount: vi.fn(), holdCount: vi.fn(), payments: vi.fn(),
  extra: vi.fn(), refund: vi.fn(), items: vi.fn(), route: vi.fn(), operations: vi.fn(), capacity: vi.fn(), van: vi.fn(), resources: vi.fn(), targetResources: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { DbNull: null }, enqueueOutbox: mocks.outbox,
  prisma: {
    booking: { findUnique: mocks.booking, updateMany: mocks.update },
    auditLog: { create: mocks.audit }, payment: { count: mocks.paymentCount, findMany: mocks.payments },
    refund: { count: mocks.refundCount }, extraCharge: { count: mocks.extraCount, create: mocks.extra },
    slotHold: { count: mocks.holdCount }, item: { findMany: mocks.items }, $transaction: mocks.transaction,
  },
}));
vi.mock('../src/server/mapbox', () => ({ routeBetween: mocks.route }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: mocks.operations }));
vi.mock('../src/server/admin/booking-capacity', () => ({ assertAdminBookingCapacity: mocks.capacity }));
vi.mock('../src/server/admin/booking-dispatch', () => ({ assertAdminBookingVanAvailable: mocks.van, assertAdminBookingResourcesAvailable: mocks.resources, assertAdminBookingResourcesForTarget: mocks.targetResources }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund }));
vi.mock('../src/server/services/availability', () => ({ invalidateAvailabilityCache: mocks.invalidate }));
import { prisma } from '@sv/db';
import { applyAdminBookingReprice, patchAdminBooking, previewAdminBookingReprice, readAdminBookingEditContext } from '../src/server/admin/booking-edit';
import { previewAdminBookingSettlement, settleAdminBookingChange } from '../src/server/admin/booking-settlement';
import { parseBookingPricingConfig } from '../src/server/admin/booking-edit-pricing';

const actor = { userId: 'admin-one', requestId: 'request-one', role: 'ADMIN' as const };
const date = '2026-11-03';
const slot = 'AFTERNOON' as const;
const address = { line1: '12 Byres Road', town: 'Glasgow', postcode: 'G11 5JY', lat: 55.87, lng: -4.29, label: '12 Byres Road, Glasgow', source: 'MANUAL' as const };
const access = { floorChoice: 'GROUND' as const, hasLift: false, carryMetres: 0, narrowAccess: false, permitZone: false };
const changes = QuoteRequestSchema.parse({ service: 'man-and-van', variant: 'standard', pickup: address,
  dropoff: { ...address, line1: '20 Byres Road' }, pickupAccess: access, dropoffAccess: access,
  items: [{ kind: 'catalogue', itemSlug: 'sofa', quantity: 1 }], addons: { helpers: 0, packing: false, assembly: false },
});
const pricingInput: PricingInput = {
  service: 'man-and-van', variant: 'standard', distanceMiles: 12,
  pickup: { floor: 0, hasLift: false }, dropoff: { floor: 0, hasLift: false },
  inventory: [{ itemId: 'sofa', name: 'Original sofa', quantity: 1, unitVolumeM3: 1.4 }],
  access: { carryMetres: 0, narrowAccess: false, permitZone: false }, addons: changes.addons,
};
const originalPrice = priceForSlot(pricingInput, DEFAULT_PRICING_CONFIG, '2026-11-02', date, slot);
function fixture() {
  return {
    id: 'booking-one', reference: 'SV-TEST12', status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null, version: 4,
    contactName: 'Test Customer', contactEmail: 'test@example.test', contactPhone: '+447700900123', adminNotes: 'Initial note',
    vanId: null, driverId: null, service: 'man-and-van', variant: 'standard', pickup: changes.pickup, dropoff: changes.dropoff,
    pricingInput, priceBreakdown: { breakdown: originalPrice.breakdown, slot: { date, multipliers: originalPrice.multipliers, slot } },
    accessDetail: { pickup: access, dropoff: access }, pricingVersionId: 'original-config', pricingVersion: { config: DEFAULT_PRICING_CONFIG }, couponId: null,
    totalPence: originalPrice.pricePence, paidPence: originalPrice.pricePence, refundedPence: 0, moveDate: new Date(`${date}T00:00:00Z`), slot,
    distanceMiles: 12, durationMinutes: 22, routeGeometry: 'stored-route', capacityUnits: 1, blocksSlots: 1,
  };
}
function ledger(amount = originalPrice.pricePence, method = 'STRIPE') { return [{ amountPence: amount, method, status: 'SUCCEEDED', refunds: [] }]; }
async function preview(nextChanges = changes) { return previewAdminBookingReprice('booking-one', { expectedVersion: 4, changes: nextChanges }); }
async function apply(nextChanges = changes) {
  const priced = await preview(nextChanges);
  return applyAdminBookingReprice('booking-one', { expectedVersion: 4, changes: nextChanges, expectedTotalPence: priced.newTotalPence,
    expectedSettlementPence: priced.settlementAmountPence, settle: priced.settle, reason: 'Customer requested this change' }, actor);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.booking.mockResolvedValue(fixture());
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (run: (tx: DbTx) => Promise<unknown>) => run(prisma));
  mocks.paymentCount.mockResolvedValue(0); mocks.refundCount.mockResolvedValue(0); mocks.extraCount.mockResolvedValue(0); mocks.holdCount.mockResolvedValue(0);
  mocks.payments.mockResolvedValue(ledger());
  mocks.extra.mockResolvedValue({ id: 'extra-one' });
  mocks.items.mockResolvedValue([{ slug: 'box', name: 'New box', volumeM3: 0.3 }]);
  mocks.route.mockResolvedValue({ distanceMiles: 18, durationMinutes: 30, geometry: 'new-route', ferry: false });
  mocks.operations.mockResolvedValue({ serviceAreaRule: 'SCOTLAND_ONLY', crossBorderMoves: false, maxInstantDistanceMiles: 200, jobSizeRules: [] });
});

afterEach(() => { vi.useRealTimers(); });

describe('real admin booking details and repricing services with isolated storage', () => {
  it('normalizes only the retired service without changing canonical settings, prices or the saved object', async () => {
    const canonical = structuredClone(DEFAULT_PRICING_CONFIG);
    canonical.services['man-and-van'].basePrice += 17;
    const saved = { ...canonical, services: { ...canonical.services, rubbish: { retired: true } } };
    const unchanged = structuredClone(saved);
    const parsed = parseBookingPricingConfig(saved);
    expect(parsed).toEqual(canonical);
    expect(saved).toEqual(unchanged);
    for (const service of SERVICE_KEYS) {
      const variant = canonical.services[service].variants[0];
      if (!variant) throw new Error(`Missing test variant for ${service}`);
      const serviceInput = { ...pricingInput, service, variant: variant.key };
      expect(priceForSlot(serviceInput, parsed, '2026-11-02', date, slot))
        .toEqual(priceForSlot(serviceInput, canonical, '2026-11-02', date, slot));
    }
    const savedPrice = priceForSlot(pricingInput, canonical, '2026-11-02', date, slot);
    mocks.booking.mockResolvedValue({ ...fixture(), totalPence: savedPrice.pricePence, paidPence: savedPrice.pricePence,
      pricingVersion: { config: saved }, priceBreakdown: { breakdown: savedPrice.breakdown, slot: { date, multipliers: savedPrice.multipliers, slot } } });
    mocks.payments.mockResolvedValue(ledger(savedPrice.pricePence));
    expect(await preview()).toMatchObject({ newTotalPence: savedPrice.pricePence, differencePence: 0 });
    expect(saved).toEqual(unchanged);
  });
  it('still rejects unknown service keys, missing canonical services and malformed supported prices', () => {
    const canonical = DEFAULT_PRICING_CONFIG;
    const incomplete: Partial<typeof canonical.services> = { ...canonical.services };
    delete incomplete.piano;
    for (const services of [
      { ...canonical.services, rubbish: {}, furnture: canonical.services.furniture },
      { ...incomplete, rubbish: canonical.services.piano },
      { ...canonical.services, rubbish: {}, furniture: { ...canonical.services.furniture, basePrice: -1 } },
    ]) expect(() => parseBookingPricingConfig({ ...canonical, services })).toThrow(AppError);
  });
  it('loads editable values and service choices from the saved booking snapshot', async () => {
    const context = await readAdminBookingEditContext('booking-one');
    expect(context).toMatchObject({ id: 'booking-one', version: 4, changes, editable: true, repriceEditable: true });
    expect(context.services.find((service) => service.key === 'man-and-van')).toMatchObject({ requiresDropoff: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('keeps contact edits available for pending payment bookings while repricing is disabled', async () => {
    mocks.booking.mockResolvedValue({ ...fixture(), status: 'PENDING_PAYMENT' });
    expect(await readAdminBookingEditContext('booking-one')).toMatchObject({ editable: true, repriceEditable: false });
  });
  it('shows a recoverable context for incomplete historic move data', async () => {
    mocks.booking.mockResolvedValue({ ...fixture(), pricingInput: {} });
    expect(await readAdminBookingEditContext('booking-one')).toMatchObject({ editable: true, changes: null, repriceEditable: false });
  });
  it('saves contact, notes and van with a conditional version, audit and scoped durable event', async () => {
    const result = await patchAdminBooking('booking-one', { expectedVersion: 4, contact: { name: 'New Name', email: 'new@example.test', phone: '+447700900124' }, notes: 'Updated note', vanId: 'van-one' }, actor);
    expect(result).toEqual({ ok: true, id: 'booking-one', version: 5 });
    expect(mocks.van).toHaveBeenCalledWith(prisma, 'booking-one', 'van-one');
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'booking-one', version: 4, status: 'CONFIRMED', deletedAt: null }, data: { contactName: 'New Name', contactEmail: 'new@example.test', contactPhone: '+447700900124', adminNotes: 'Updated note', vanId: 'van-one', version: { increment: 1 } } });
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.outbox).toHaveBeenCalledWith(prisma, 'booking.updated', { bookingId: 'booking-one' }, 'admin-booking:booking-one:5:updated');
  });
  it('rejects stale edits, nonexistent bookings, and van conflicts without a successful update', async () => {
    await expect(patchAdminBooking('booking-one', { expectedVersion: 3, notes: 'stale' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.booking.mockResolvedValueOnce(null);
    await expect(patchAdminBooking('missing', { expectedVersion: 4, notes: 'missing' }, actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    mocks.van.mockRejectedValue(new AppError('CONFLICT', 'Van has another job'));
    await expect(patchAdminBooking('booking-one', { expectedVersion: 4, vanId: 'occupied-van' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('reprices an unchanged booking to exactly the original penny and retains its item volumes', async () => {
    const result = await preview();
    expect(result).toMatchObject({ currentTotalPence: originalPrice.pricePence, newTotalPence: originalPrice.pricePence, differencePence: 0, settle: 'NONE', settlementAmountPence: 0 });
    expect(mocks.items).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it('prices changed quantities at the original volume and original slot multipliers', async () => {
    const edited = { ...changes, items: [{ kind: 'catalogue' as const, itemSlug: 'sofa', quantity: 2 }] };
    const expected = priceForSlot({ ...pricingInput, inventory: [{ ...pricingInput.inventory[0], itemId: 'sofa', name: 'Original sofa', unitVolumeM3: 1.4, quantity: 2 }] }, DEFAULT_PRICING_CONFIG, '2026-11-02', date, slot);
    const result = await preview(edited);
    expect(result.newTotalPence).toBe(expected.pricePence);
    expect(mocks.items).not.toHaveBeenCalled();
  });
  it('calculates a changed address using Mapbox and stores its route plus priced inputs', async () => {
    await apply({ ...changes, dropoff: { ...address, line1: 'Another street', lng: -4.4 } });
    expect(mocks.route).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ distanceMiles: 18, durationMinutes: 30, routeGeometry: 'new-route', version: { increment: 1 } }) as unknown }));
    expect(mocks.extra).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ includedInBookingTotal: true, status: 'AWAITING_PAYMENT' }) as unknown }));
    expect(mocks.capacity).toHaveBeenCalledTimes(2);
  });
  it('refuses changed client totals and never trusts a client item volume', async () => {
    expect(RepriceApplySchema.safeParse({ expectedVersion: 4, changes: { ...changes, items: [{ kind: 'catalogue', itemSlug: 'sofa', quantity: 1, unitVolumeM3: 0 }] }, expectedTotalPence: 1, expectedSettlementPence: 0, settle: 'NONE', reason: 'test' }).success).toBe(false);
    await expect(applyAdminBookingReprice('booking-one', { expectedVersion: 4, changes, expectedTotalPence: 1, expectedSettlementPence: 0, settle: 'NONE', reason: 'test' }, actor)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(['paymentCount', 'refundCount', 'extraCount', 'holdCount'] as const)('blocks unresolved %s before a preview or another financial edit', async (key) => {
    mocks[key].mockResolvedValue(1);
    await expect(preview()).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(applyAdminBookingReprice('booking-one', { expectedVersion: 4, changes, expectedTotalPence: originalPrice.pricePence, expectedSettlementPence: 0, settle: 'NONE', reason: 'test' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.extra).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects a version race and full capacity before creating financial rows', async () => {
    mocks.booking.mockResolvedValueOnce(fixture()).mockResolvedValueOnce({ ...fixture(), version: 5 });
    await expect(applyAdminBookingReprice('booking-one', { expectedVersion: 4, changes, expectedTotalPence: originalPrice.pricePence, expectedSettlementPence: 0, settle: 'NONE', reason: 'test' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.booking.mockResolvedValue(fixture()); mocks.capacity.mockRejectedValue(new AppError('SLOT_UNAVAILABLE', 'Full'));
    await expect(apply()).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.extra).not.toHaveBeenCalled();
  });
  it.each([{ couponId: 'fixed-coupon' }, { jobStage: 'LOADING' }, { status: 'CANCELLED' }, { priceBreakdown: { manual: true, pricePence: 100 } }])('blocks a non-repriceable saved booking %j', async (override) => {
    mocks.booking.mockResolvedValue({ ...fixture(), ...override });
    await expect(preview()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('uses server catalogue volumes for new items while retaining the original item snapshot', async () => {
    const edited = { ...changes, items: [...changes.items, { kind: 'catalogue' as const, itemSlug: 'box', quantity: 2 }] };
    const expected = priceForSlot({ ...pricingInput, inventory: [...pricingInput.inventory, { itemId: 'box', name: 'New box', quantity: 2, unitVolumeM3: 0.3 }] }, DEFAULT_PRICING_CONFIG, '2026-11-02', date, slot);
    expect((await preview(edited)).newTotalPence).toBe(expected.pricePence);
    expect(mocks.items).toHaveBeenCalledWith({ where: { active: true, slug: { in: ['box'] } }, select: { name: true, slug: true, volumeM3: true } });
  });
  it('does not create a charge or event when the conditional update loses a race', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(apply({ ...changes, addons: { ...changes.addons, packing: true } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.extra).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('checks the assigned resources when a larger inventory occupies an extra period', async () => {
    mocks.operations.mockResolvedValue({ serviceAreaRule: 'SCOTLAND_ONLY', crossBorderMoves: false, maxInstantDistanceMiles: 200, jobSizeRules: [{ minVolumeM3: 2, blocksSlots: 2, capacityUnits: 1 }] });
    const edited = { ...changes, items: [{ kind: 'catalogue' as const, itemSlug: 'sofa', quantity: 2 }] };
    mocks.targetResources.mockRejectedValueOnce(new AppError('CONFLICT', 'Driver has another job in the extra period'));
    await expect(preview(edited)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.resources.mockRejectedValueOnce(new AppError('CONFLICT', 'Van became occupied'));
    await expect(apply(edited)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.resources).toHaveBeenCalledWith(prisma, 'booking-one', expect.any(Date));
    expect(mocks.extra).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('enforces same-day against the London civil date in preview and apply', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T23:30:00.000Z')); // Already 2 June in London.
    mocks.booking.mockResolvedValue({ ...fixture(), moveDate: new Date('2026-06-03T00:00:00.000Z') });
    const sameDay = { ...changes, service: 'same-day' as const };
    await expect(preview(sameDay)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(applyAdminBookingReprice('booking-one', { expectedVersion: 4, changes: sameDay, expectedTotalPence: originalPrice.pricePence, expectedSettlementPence: 0, settle: 'NONE', reason: 'Change service' }, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.booking.mockResolvedValue({ ...fixture(), moveDate: new Date('2026-06-02T00:00:00.000Z') });
    expect((await preview(sameDay)).newTotalPence).toBeGreaterThan(0);
  });
  it('rejects a newly changed ferry route without saving partial details', async () => {
    mocks.route.mockResolvedValue({ distanceMiles: 18, durationMinutes: 30, geometry: 'ferry-route', ferry: true });
    await expect(apply({ ...changes, dropoff: { ...address, line1: 'Ferry island' } })).rejects.toMatchObject({ code: 'MANUAL_QUOTE_REQUIRED' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('admin changes share one settlement basis', () => {
  it('collects only the remaining balance, marks its amount already included and scopes its event', async () => {
    const booking = { id: 'booking-one', version: 4, totalPence: 10000, paidPence: 9000, refundedPence: 0 };
    mocks.payments.mockResolvedValue(ledger(9000));
    expect(await settleAdminBookingChange(prisma, booking, { newTotalPence: 12000, expectedSettlementPence: 3000, settle: 'EXTRA_CHARGE', reason: 'Add furniture', actorUserId: actor.userId })).toEqual({ extraChargeId: 'extra-one' });
    expect(mocks.extra).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountPence: 3000, includedInBookingTotal: true }) as unknown }));
    expect(mocks.outbox).toHaveBeenCalledWith(prisma, 'extra_charge.awaiting_payment', { bookingId: booking.id, extraChargeId: 'extra-one' }, 'admin-booking:booking-one:5:extra');
  });
  it('refunds net paid after earlier refunds instead of refunding the entire price difference again', async () => {
    const booking = { id: 'booking-one', version: 4, totalPence: 10000, paidPence: 10000, refundedPence: 1000 };
    mocks.payments.mockResolvedValue([{ ...ledger(10000)[0], refunds: [{ amountPence: 1000, status: 'SUCCEEDED' }] }]);
    await settleAdminBookingChange(prisma, booking, { newTotalPence: 8000, expectedSettlementPence: 1000, settle: 'REFUND', reason: 'Fewer items', actorUserId: actor.userId });
    expect(mocks.refund).toHaveBeenCalledWith(prisma, 'booking-one', 1000, 'Fewer items', { dedupePrefix: 'admin-booking:booking-one:5:refund' });
  });
  it('rejects an unconfirmed settlement amount even when the target total is unchanged from preview', async () => {
    mocks.payments.mockResolvedValue(ledger(10000));
    await expect(settleAdminBookingChange(prisma, { id: 'booking-one', version: 4, totalPence: 10000, paidPence: 10000, refundedPence: 0 }, { newTotalPence: 12000, expectedSettlementPence: 1000, settle: 'EXTRA_CHARGE', reason: 'Add items', actorUserId: actor.userId })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(mocks.extra).not.toHaveBeenCalled();
  });
  it('explains unsupported offline refunds in the preview before any commit', async () => {
    mocks.payments.mockResolvedValue(ledger(10000, 'OFFLINE'));
    await expect(previewAdminBookingSettlement(prisma, { id: 'booking-one', version: 4, totalPence: 10000, paidPence: 10000, refundedPence: 0 }, 9000)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('offline refund') as unknown });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
