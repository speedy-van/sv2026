import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const mocks = vi.hoisted(() => ({
  event: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), payment: vi.fn(), paymentById: vi.fn(),
  paymentUpdate: vi.fn(), paymentFailure: vi.fn(), bookingUpdate: vi.fn(), bookingUpdateMany: vi.fn(), claim: vi.fn(), enqueue: vi.fn(), recompute: vi.fn(), refund: vi.fn(),
}));
vi.mock('@sv/db', () => {
  const tx = {
    payment: { findUnique: mocks.paymentById, updateMany: mocks.paymentUpdate, update: mocks.paymentFailure },
    booking: { update: mocks.bookingUpdate, updateMany: mocks.bookingUpdateMany },
    extraCharge: { updateMany: mocks.claim },
  };
  return {
    assertSlotCapacity: vi.fn(), enqueueOutbox: mocks.enqueue,
    prisma: {
      payment: { findFirst: mocks.payment },
      stripeEvent: { findUnique: mocks.event, create: mocks.createEvent, update: mocks.updateEvent },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund, recomputeBookingMoney: mocks.recompute }));
import { handleStripeEvent } from '../src/server/services/stripe-webhook';

function event(id = 'evt_admin_edit'): Stripe.Event {
  // A webhook fixture containing the event/intent fields consumed by this service.
  const payload: unknown = {
    id, object: 'event', api_version: null, created: 1, livemode: false, pending_webhooks: 1, request: null,
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_edit', object: 'payment_intent', amount: 3500, amount_received: 3500, currency: 'gbp', latest_charge: 'ch_edit', metadata: { paymentId: 'payment-edit' } } },
  };
  return payload as Stripe.Event;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.event.mockResolvedValue(null);
  mocks.payment.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', kind: 'EXTRA_CHARGE', amountPence: 3500, status: 'REQUIRES_PAYMENT' });
  mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, booking: { status: 'CONFIRMED' }, extraCharge: { id: 'extra-edit', status: 'AWAITING_PAYMENT', includedInBookingTotal: true } });
  mocks.paymentUpdate.mockResolvedValue({ count: 1 });
  mocks.claim.mockResolvedValue({ count: 1 });
});
describe('payment of an agreed admin booking change', () => {
  it.each(['CANCELLED', 'EXPIRED'])('refunds a late change payment for a %s booking without resurrecting it', async (status) => {
    mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, booking: { status }, extraCharge: { id: 'extra-edit', status: 'AWAITING_PAYMENT', includedInBookingTotal: true } });
    await handleStripeEvent(event());
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'booking-edit', 3500, expect.any(String), { dedupePrefix: 'cancelled-admin-edit:payment-edit', paymentId: 'payment-edit' });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('refunds a revoked change charge even if the booking remains confirmed', async () => {
    mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, booking: { status: 'CONFIRMED' }, extraCharge: { id: 'extra-edit', status: 'CANCELED', includedInBookingTotal: true } });
    await handleStripeEvent(event());
    expect(mocks.refund).toHaveBeenCalledOnce();
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
  it('records the payment without adding the agreed difference to the total a second time', async () => {
    expect(await handleStripeEvent(event())).toBe('processed');
    expect(mocks.bookingUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'booking-edit' }, data: { deletedAt: null, version: { increment: 1 } },
    });
    expect(mocks.recompute).toHaveBeenCalledWith(expect.anything(), 'booking-edit');
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'booking.extra_paid', { bookingId: 'booking-edit', paymentId: 'payment-edit' }, 'booking.extra_paid:payment-edit');
  });
  it('preserves legacy charges whose value has not yet been included in the total', async () => {
    mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, extraCharge: { id: 'extra-edit', status: 'AWAITING_PAYMENT', includedInBookingTotal: false } });
    await handleStripeEvent(event());
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({ where: { id: 'booking-edit' }, data: { deletedAt: null, version: { increment: 1 }, totalPence: { increment: 3500 } } });
  });
  it.each(['already-paid', 'concurrent-claim'] as const)('does not apply a duplicate %s extra charge', async (kind) => {
    if (kind === 'already-paid') mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, extraCharge: { id: 'extra-edit', status: 'PAID', includedInBookingTotal: false } });
    else mocks.claim.mockResolvedValue({ count: 0 });
    await handleStripeEvent(event());
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.recompute).toHaveBeenCalledOnce();
  });
  it('claims a charge conditionally before changing booking totals', async () => {
    await handleStripeEvent(event());
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith({ data: { status: 'PAID' }, where: { id: 'extra-edit', status: { not: 'PAID' } } });
  });
  it('rejects a payment without its approved extra charge rather than silently inflating the booking', async () => {
    mocks.paymentById.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', amountPence: 3500, extraCharge: null });
    await expect(handleStripeEvent(event())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
  it('keeps the signature-independent amount check before any financial change', async () => {
    mocks.payment.mockResolvedValue({ id: 'payment-edit', bookingId: 'booking-edit', kind: 'EXTRA_CHARGE', amountPence: 4000 });
    await handleStripeEvent(event());
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentFailure).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'system.alert', expect.objectContaining({ issue: 'Stripe amount mismatch' }), 'system.alert:payment-mismatch:payment-edit');
  });
  it('treats an already processed Stripe event as a replay', async () => {
    mocks.event.mockResolvedValue({ processedAt: new Date() });
    expect(await handleStripeEvent(event())).toBe('replay');
    expect(mocks.payment).not.toHaveBeenCalled();
  });
});
