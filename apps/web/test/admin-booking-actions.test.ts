import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTx } from '@sv/db';
import { DEFAULT_PRICING_CONFIG, SERVICE_KEYS } from '@sv/pricing';
const mocks = vi.hoisted(() => ({ booking: vi.fn(), create: vi.fn(), used: vi.fn(), update: vi.fn(), paymentCreate: vi.fn(), paymentUpdate: vi.fn(), customer: vi.fn(), quote: vi.fn(), quoteUpdate: vi.fn(), audit: vi.fn(), enqueue: vi.fn(), transaction: vi.fn(), capacity: vi.fn(), price: vi.fn(), availability: vi.fn(), cancelIntent: vi.fn(), refund: vi.fn(), recompute: vi.fn(), extra: vi.fn(), assignments: vi.fn(), holds: vi.fn(), operations: vi.fn(), settings: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { DbNull: null, JsonNull: null }, enqueueOutbox: mocks.enqueue, assertSlotCapacity: mocks.capacity, prisma: {
  booking: { findUnique: mocks.booking, findFirst: mocks.used, create: mocks.create, updateMany: mocks.update }, payment: { create: mocks.paymentCreate, updateMany: mocks.paymentUpdate },
  customer: { upsert: mocks.customer }, quote: { findUnique: mocks.quote, update: mocks.quoteUpdate }, auditLog: { create: mocks.audit }, extraCharge: { create: mocks.extra }, assignment: { updateMany: mocks.assignments }, slotHold: { deleteMany: mocks.holds }, $transaction: mocks.transaction,
} }));
vi.mock('../src/server/services/booking', () => ({ priceSlot: mocks.price, assertChosenSlotAvailable: mocks.availability, uniqueReference: () => 'SV-TEST12' }));
vi.mock('../src/server/services/customer-self-service', () => ({ payLinkForBooking: () => 'pay-token' }));
vi.mock('../src/server/services/availability', () => ({ invalidateAvailabilityCache: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund, recomputeBookingMoney: mocks.recompute }));
vi.mock('../src/server/integrations/stripe', () => ({ cancelPaymentIntentForCleanup: mocks.cancelIntent }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: vi.fn() }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: mocks.operations, getSetting: mocks.settings }));
import { prisma } from '@sv/db';
import { cancelAdminBooking, cancellationRefund, createAdminExtraCharge, createAdminPhoneBooking, previewAdminBookingCancellation, readAdminBookingActionsContext, readAdminBookingCreateContext, recordAdminOfflinePayment, refundAdminBookingPayment, resendAdminBookingEmail } from '../src/server/admin/booking-actions';
import { getActivePricingConfig } from '../src/server/services/catalogue';
const actor = { userId: 'owner-1', requestId: 'request-1', role: 'OWNER' as const };
const now = new Date('2031-01-01T12:00:00Z');
const contact = { name: 'Customer One', email: 'customer@example.test', phone: '+447700900123' };
const address = { line1: '12 Byres Road', town: 'Glasgow', postcode: 'G11 5JY', lat: 55.87, lng: -4.29, label: '12 Byres Road, Glasgow', source: 'MANUAL' };
function fixture() { return { id: 'booking-1', reference: 'SV-TEST12', version: 4, deletedAt: null, status: 'CONFIRMED', jobStage: 'NOT_STARTED', dispatchStatus: 'ACCEPTED', driverId: 'driver-1', totalPence: 10000, paidPence: 10000, refundedPence: 0, moveDate: new Date('2031-01-10'), slot: 'MORNING', holdExpiresAt: new Date('2031-01-02'), quoteId: 'quote-1',
  payments: [{ id: 'payment-1', bookingId: 'booking-1', kind: 'ADMIN_BOOKING', method: 'STRIPE', status: 'SUCCEEDED', amountPence: 10000, refunds: [], stripePaymentIntentId: 'pi-1', stripeCheckoutSessionId: null, createdAt: now }], extraCharges: [], slotHolds: [] }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.booking.mockResolvedValue(fixture()); mocks.update.mockResolvedValue({ count: 1 }); mocks.customer.mockResolvedValue({ id: 'customer-1' }); mocks.paymentCreate.mockResolvedValue({ id: 'new-payment' }); mocks.extra.mockResolvedValue({ id: 'extra-1' });
  mocks.transaction.mockImplementation((run: (tx: DbTx) => Promise<unknown>) => run(prisma));
  mocks.operations.mockResolvedValue({ phoneBookingHoldHours: 24, minLeadMinutes: 60, bookingPaused: false, slotWindows: { MORNING: { start: '08:00' } } });
  mocks.settings.mockImplementation((key: string) => Promise.resolve(key === 'web' ? { canonicalOrigin: 'https://www.speedyvan.uk' } : { freeCancellationHours: 48, noRefundHours: 24, lateCancellationRefundPercent: 50 }));
});
describe('admin booking financial actions with isolated storage', () => {
  it('requires a configured policy and applies explicit refund decisions without inventing policy', () => {
    const missing = { freeCancellationHours: null, noRefundHours: null, lateCancellationRefundPercent: null };
    expect(() => cancellationRefund({ mode: 'POLICY' }, 10000, 100, missing)).toThrow('not configured');
    expect(cancellationRefund({ mode: 'FULL' }, 10000, 1, missing).refundPence).toBe(10000);
    expect(cancellationRefund({ mode: 'CUSTOM', amountPence: 1234 }, 10000, 1, missing).refundPence).toBe(1234);
    expect(cancellationRefund({ mode: 'NONE' }, 10000, 1, missing).refundPence).toBe(0);
    expect(cancellationRefund({ mode: 'POLICY' }, 10001, 30, { freeCancellationHours: 48, noRefundHours: 24, lateCancellationRefundPercent: 50 }).refundPence).toBe(5000);
  });
  it('previews configured cancellation and rejects stale or changed refund amounts', async () => {
    const input = { expectedVersion: 4, refund: { mode: 'POLICY' as const }, reason: 'Customer request', notifyCustomer: true };
    expect(await previewAdminBookingCancellation('booking-1', input, now)).toMatchObject({ refundPence: 10000, paidNetPence: 10000, willUnassignDriver: true });
    await expect(cancelAdminBooking('booking-1', { ...input, expectedRefundPence: 5000 }, actor, now)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('cancels and withdraws assignments with an audited version and durable refund', async () => {
    const response = await cancelAdminBooking('booking-1', { expectedVersion: 4, refund: { mode: 'FULL' }, reason: 'Customer request', notifyCustomer: false, expectedRefundPence: 10000 }, actor, now);
    expect(response).toEqual({ ok: true, id: 'booking-1', version: 5 });
    expect(mocks.update).toHaveBeenCalledWith(contains({ where: { id: 'booking-1', version: 4, status: 'CONFIRMED', deletedAt: null }, data: contains({ status: 'CANCELLED', cancelledBy: 'ADMIN' }) }));
    expect(mocks.assignments).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.refund).toHaveBeenCalledWith(prisma, 'booking-1', 10000, 'Customer request', { dedupePrefix: 'admin-booking:booking-1:5:refund', notifyCustomer: false });
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'booking.cancelled', { bookingId: 'booking-1', notifyCustomer: false }, 'admin-booking:booking-1:5:cancelled');
  });
  it('reserves pending refunds and refuses cancellation until reconciliation', async () => {
    const booking = fixture(); mocks.booking.mockResolvedValue({ ...booking, payments: [{ ...booking.payments[0], refunds: [{ status: 'PENDING', amountPence: 3000 }] }] });
    const context = await readAdminBookingActionsContext('booking-1', actor);
    expect(context.payments[0]?.refundablePence).toBe(7000); expect(context.cancellation.allowed).toBe(false);
    await expect(refundAdminBookingPayment('booking-1', { expectedVersion: 4, paymentId: 'payment-1', amountPence: 1000, reason: 'Refund' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('limits independent refunds to the selected payment', async () => {
    await refundAdminBookingPayment('booking-1', { expectedVersion: 4, paymentId: 'payment-1', amountPence: 1234, reason: 'Agreed refund' }, actor);
    expect(mocks.refund).toHaveBeenCalledWith(prisma, 'booking-1', 1234, 'Agreed refund', { paymentId: 'payment-1', dedupePrefix: 'admin-booking:booking-1:5:refund' });
    await expect(refundAdminBookingPayment('booking-1', { expectedVersion: 4, paymentId: 'another-bookings-payment', amountPence: 1234, reason: 'Refund' }, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('refuses changes when the stored ledger is not reconciled', async () => {
    mocks.booking.mockResolvedValue({ ...fixture(), paidPence: 9000 });
    await expect(readAdminBookingActionsContext('booking-1', actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('blocks offline payment for admins and partial replacement of card collection', async () => {
    const input = { expectedVersion: 4, amountPence: 5000, reference: 'Bank-123', paidAt: now.toISOString() };
    await expect(recordAdminOfflinePayment('booking-1', input, { ...actor, role: 'ADMIN' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const booking = fixture(); mocks.booking.mockResolvedValue({ ...booking, status: 'PENDING_PAYMENT', paidPence: 0, payments: [{ ...booking.payments[0], status: 'REQUIRES_PAYMENT' }] });
    await expect(recordAdminOfflinePayment('booking-1', input, actor, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.cancelIntent).not.toHaveBeenCalled();
  });
  it('settles the whole balance offline after closing its card intent', async () => {
    const booking = fixture(); mocks.booking.mockResolvedValue({ ...booking, status: 'PENDING_PAYMENT', paidPence: 0, payments: [{ ...booking.payments[0], status: 'REQUIRES_PAYMENT' }] });
    await recordAdminOfflinePayment('booking-1', { expectedVersion: 4, amountPence: 10000, reference: 'Bank-123', paidAt: now.toISOString() }, actor, now);
    expect(mocks.cancelIntent).toHaveBeenCalledWith('pi-1', { bookingId: 'booking-1', paymentId: 'payment-1' });
    expect(mocks.paymentCreate).toHaveBeenCalledWith(contains({ data: contains({ method: 'OFFLINE', status: 'SUCCEEDED', recordedById: 'owner-1', amountPence: 10000 }) }));
    expect(mocks.recompute).toHaveBeenCalledWith(prisma, 'booking-1'); expect(mocks.quoteUpdate).toHaveBeenCalledOnce();
  });
  it('does not overwrite a payment that changes during provider cancellation', async () => {
    const booking = fixture(); const pending = { ...booking, status: 'PENDING_PAYMENT', paidPence: 0, payments: [{ ...booking.payments[0], status: 'REQUIRES_PAYMENT' }] };
    mocks.booking.mockResolvedValueOnce(pending).mockResolvedValue({ ...pending, payments: [{ ...pending.payments[0], status: 'PROCESSING' }] });
    await expect(recordAdminOfflinePayment('booking-1', { expectedVersion: 4, amountPence: 10000, reference: 'Bank-123', paidAt: now.toISOString() }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });
  it('includes an approved extra charge in the booking total once', async () => {
    await createAdminExtraCharge('booking-1', { expectedVersion: 4, amountPence: 2000, description: 'Additional item' }, actor, now);
    expect(mocks.update).toHaveBeenCalledWith(contains({ data: contains({ totalPence: { increment: 2000 } }) }));
    expect(mocks.extra).toHaveBeenCalledWith(contains({ data: contains({ includedInBookingTotal: true, status: 'AWAITING_PAYMENT' }) }));
  });
  it('rejects expired payment links and creates a scoped resend event', async () => {
    await expect(resendAdminBookingEmail('booking-1', { expectedVersion: 4, template: 'PAYMENT_LINK' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    await resendAdminBookingEmail('booking-1', { expectedVersion: 4, template: 'CONFIRMATION' }, actor, now);
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'booking.email_resent', { bookingId: 'booking-1', bookingVersion: 5, template: 'CONFIRMATION' }, 'admin-booking:booking-1:5:email');
  });
});
describe('phone booking creation', () => {
  it('loads current canonical services from a saved config containing the retired service', async () => {
    const config = { ...DEFAULT_PRICING_CONFIG, services: { ...DEFAULT_PRICING_CONFIG.services, rubbish: { retired: true } } };
    vi.mocked(getActivePricingConfig).mockResolvedValue({ id: 'pricing-1', version: 1, config });
    const context = await readAdminBookingCreateContext();
    expect(context).toMatchObject({ ready: true, reason: null });
    expect(context.services.map((service) => service.key)).toEqual(SERVICE_KEYS);
    expect(context.services.find((service) => service.key === 'man-and-van')).toMatchObject({
      label: config.services['man-and-van'].label, variants: config.services['man-and-van'].variants.map(({ key, label, manualQuote }) => ({ key, label, manualQuote })),
    });
    expect(config.services.rubbish).toEqual({ retired: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  const input = { quotePublicId: 'public-quote', date: '2031-01-10', slot: 'MORNING' as const, contact, payment: { mode: 'LINK' as const }, expectedTotalPence: 10000, idempotencyKey: 'c27441e0-8b89-484c-b7d2-94d472b153de' };
  beforeEach(() => { mocks.booking.mockResolvedValue(null); mocks.quote.mockResolvedValue({ id: 'quote-1', status: 'ACTIVE', requiresManualQuote: false, pickup: address, dropoff: null, input: {}, accessDetail: {}, service: 'man-and-van', variant: 'standard', capacityUnits: 1, blocksSlots: 1, distanceMiles: 1, durationMinutes: 1, routeGeometry: null }); mocks.price.mockResolvedValue({ totalPence: 10000, calendar: [], breakdown: {}, multipliers: {}, pricingVersionId: 'pricing-1' }); mocks.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...data, id: 'new-booking', version: 0 })); });
  it('uses server pricing and locked capacity then persists the payment link in the outbox', async () => {
    const response = await createAdminPhoneBooking(input, actor, now);
    expect(response).toMatchObject({ id: 'new-booking', reference: 'SV-TEST12', status: 'PENDING_PAYMENT', paymentUrl: 'https://www.speedyvan.uk/pay/pay-token' });
    expect(mocks.capacity).toHaveBeenCalledOnce(); expect(mocks.availability).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(contains({ data: contains({ source: 'ADMIN_PHONE', totalPence: 10000, status: 'PENDING_PAYMENT' }) }));
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'booking.payment_requested', { bookingId: 'new-booking', bookingVersion: 0 }, 'admin-booking:new-booking:0:created');
  });
  it('checks the reviewed price before reserving capacity', async () => {
    await expect(createAdminPhoneBooking({ ...input, expectedTotalPence: 9999 }, actor, now)).rejects.toMatchObject({ code: 'PRICE_CHANGED' }); expect(mocks.capacity).not.toHaveBeenCalled();
  });
  it('requires owner authority for paid offline phone bookings', async () => {
    await expect(createAdminPhoneBooking({ ...input, payment: { mode: 'OFFLINE', reference: 'BANK' } }, { ...actor, role: 'ADMIN' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await createAdminPhoneBooking({ ...input, payment: { mode: 'OFFLINE', reference: 'BANK' } }, actor, now);
    expect(mocks.paymentCreate).toHaveBeenCalledWith(contains({ data: contains({ method: 'OFFLINE', status: 'SUCCEEDED', offlineReference: 'BANK' }) }));
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'booking.confirmed', { bookingId: 'new-booking', bookingVersion: 0 }, 'admin-booking:new-booking:0:created');
  });
});

function contains(value: unknown): unknown { return expect.objectContaining(value); }
