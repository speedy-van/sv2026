import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventFind: vi.fn(), eventCreate: vi.fn(), eventUpdate: vi.fn(),
  paymentFind: vi.fn(), paymentById: vi.fn(), paymentUpdate: vi.fn(),
  bookingUpdate: vi.fn(), enqueue: vi.fn(), recompute: vi.fn(), refund: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  assertSlotCapacity: vi.fn(), enqueueOutbox: mocks.enqueue,
  prisma: {
    stripeEvent: { findUnique: mocks.eventFind, create: mocks.eventCreate, update: mocks.eventUpdate },
    payment: { findFirst: mocks.paymentFind }, $transaction: mocks.transaction,
  },
}));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund, recomputeBookingMoney: mocks.recompute }));

import { handleStripeEvent } from '../src/server/services/stripe-webhook';

const now = new Date('2031-01-01T12:00:00Z');
const tx = {
  payment: { findUnique: mocks.paymentById, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdate },
  booking: { update: mocks.bookingUpdate, updateMany: mocks.bookingUpdate },
};
const pendingPayment = {
  id: 'payment-one', bookingId: 'booking-one', kind: 'BOOKING', amountPence: 12345, status: 'REQUIRES_PAYMENT',
  booking: {
    id: 'booking-one', status: 'PENDING_PAYMENT', holdExpiresAt: new Date('2031-01-01T12:15:00Z'),
    paidPence: 0, refundedPence: 0, totalPence: 12345, quoteId: null, deletedAt: null,
  },
};
function event(overrides: Record<string, unknown> = {}, type: Stripe.Event.Type = 'payment_intent.succeeded'): Stripe.Event {
  // Some cases deliberately omit/alter fields received over the wire, so the
  // fixture starts unknown before exercising the service's runtime checks.
  const fixture: unknown = {
    id: 'evt_confirmation', type, object: 'event', api_version: null, created: 1_925_040_000,
    livemode: false, pending_webhooks: 1, request: null,
    data: { object: {
      id: 'pi_one', object: 'payment_intent', amount: 12345, amount_received: 12345,
      currency: 'gbp', latest_charge: 'ch_one', metadata: { paymentId: 'payment-one' }, ...overrides,
    } },
  };
  return fixture as Stripe.Event;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.eventFind.mockResolvedValue(null);
  mocks.paymentFind.mockResolvedValue(pendingPayment);
  mocks.paymentById.mockResolvedValue(pendingPayment);
  mocks.paymentUpdate.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('Stripe confirmation is the source of the durable booking email event', () => {
  it('commits successful payment, booking confirmation and one stable outbox root together', async () => {
    expect(await handleStripeEvent(event(), now)).toBe('processed');
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'payment-one' }, data: { status: 'SUCCEEDED', stripeChargeId: 'ch_one', stripePaymentIntentId: 'pi_one' },
    });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking-one' }, data: { deletedAt: null, holdExpiresAt: null, status: 'CONFIRMED' },
    });
    expect(mocks.recompute).toHaveBeenCalledExactlyOnceWith(tx, 'booking-one');
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(tx, 'booking.confirmed', { bookingId: 'booking-one' }, 'booking.confirmed:booking-one');
  });

  it.each([
    { amount_received: 0 }, { amount_received: 12344 }, { amount_received: undefined }, { currency: 'eur' },
  ])('does not treat the requested amount as received money when Stripe reports %j', async (overrides) => {
    await handleStripeEvent(event(overrides), now);
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
      tx, 'system.alert', { bookingId: 'booking-one', issue: 'Stripe amount mismatch', paymentId: 'payment-one' },
      'system.alert:payment-mismatch:payment-one',
    );
  });

  it.each(['payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled'] as const)(
    'does not queue confirmation for %s', async (type) => {
      await handleStripeEvent(event({}, type), now);
      expect(mocks.enqueue).not.toHaveBeenCalled();
      expect(mocks.bookingUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) as unknown }));
    },
  );

  it('returns immediately for a processed Stripe event replay', async () => {
    mocks.eventFind.mockResolvedValue({ processedAt: now });
    expect(await handleStripeEvent(event(), now)).toBe('replay');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue again when a different event refers to an already confirmed payment', async () => {
    const succeeded = { ...pendingPayment, status: 'SUCCEEDED', booking: { ...pendingPayment.booking, status: 'CONFIRMED' } };
    mocks.paymentFind.mockResolvedValue(succeeded);
    mocks.paymentById.mockResolvedValue(succeeded);
    await handleStripeEvent(event(), now);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('leaves a failed transaction replayable instead of reporting the event processed', async () => {
    mocks.enqueue.mockRejectedValue(new Error('Outbox commit failed'));
    await expect(handleStripeEvent(event(), now)).rejects.toThrow('Outbox commit failed');
    expect(mocks.eventUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: 'evt_confirmation' }, data: { error: 'Outbox commit failed' } });
  });
});
