import { AppError } from '@sv/contracts';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  paymentFindFirst: vi.fn(), paymentFindUnique: vi.fn(), paymentUpdate: vi.fn(), paymentUpdateMany: vi.fn(),
  bookingUpdate: vi.fn(), bookingUpdateMany: vi.fn(), stripeEventFindUnique: vi.fn(), stripeEventCreate: vi.fn(),
  stripeEventUpdate: vi.fn(), transaction: vi.fn(), capacity: vi.fn(), enqueue: vi.fn(), refund: vi.fn(), recompute: vi.fn(),
  extraChargeUpdate: vi.fn(), slotHoldFindUnique: vi.fn(), slotHoldDelete: vi.fn(), assignmentUpdateMany: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  assertSlotCapacity: mocks.capacity, enqueueOutbox: mocks.enqueue,
  prisma: {
    $transaction: mocks.transaction, payment: { findFirst: mocks.paymentFindFirst },
    stripeEvent: { findUnique: mocks.stripeEventFindUnique, create: mocks.stripeEventCreate, update: mocks.stripeEventUpdate },
  },
}));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund, recomputeBookingMoney: mocks.recompute }));

import { handleStripeEvent } from '../src/server/services/stripe-webhook';

const now = new Date('2031-03-01T12:00:00.000Z');
type BookingState = {
  id: string; status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  deletedAt: Date | null; holdExpiresAt: Date | null; blocksSlots: number; capacityUnits: number;
  moveDate: Date; quoteId: string | null; slot: 'MORNING'; version: number; totalPence: number;
};
let booking: BookingState;
let paymentStatus: 'REQUIRES_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'CANCELED';
let paymentKind: 'BOOKING' | 'EXTRA_CHARGE' | 'RESCHEDULE_DIFFERENCE';
let extraChargeStatus: 'AWAITING_PAYMENT' | 'PAID';
const tx = {
  payment: { findUnique: mocks.paymentFindUnique, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
  booking: { update: mocks.bookingUpdate, updateMany: mocks.bookingUpdateMany },
  extraCharge: { update: mocks.extraChargeUpdate }, slotHold: { findUnique: mocks.slotHoldFindUnique, delete: mocks.slotHoldDelete },
  assignment: { updateMany: mocks.assignmentUpdateMany },
};

function event(type: 'payment_intent.succeeded' | 'payment_intent.processing' | 'payment_intent.payment_failed' | 'payment_intent.canceled'): Stripe.Event {
  return { id: 'evt_unit', type, data: { object: {
    id: 'pi_unit', metadata: { paymentId: 'payment-unit' }, amount_received: 10000, amount: 10000,
    currency: 'gbp', latest_charge: 'charge-unit', last_payment_error: null,
  } } } as unknown as Stripe.Event;
}

beforeEach(() => {
  vi.resetAllMocks();
  booking = {
    id: 'booking-unit', status: 'CANCELLED', deletedAt: now, holdExpiresAt: null,
    blocksSlots: 1, capacityUnits: 1, moveDate: new Date('2031-03-02T00:00:00.000Z'),
    quoteId: null, slot: 'MORNING', version: 4, totalPence: 20000,
  };
  paymentStatus = 'CANCELED';
  paymentKind = 'BOOKING';
  extraChargeStatus = 'AWAITING_PAYMENT';
  const row = () => ({ id: 'payment-unit', bookingId: booking.id, amountPence: 10000, kind: paymentKind, status: paymentStatus, booking: { ...booking }, extraCharge: { id: 'extra-unit', status: extraChargeStatus } });
  mocks.paymentFindFirst.mockImplementation(() => Promise.resolve(row()));
  mocks.paymentFindUnique.mockImplementation(() => Promise.resolve(row()));
  mocks.paymentUpdate.mockImplementation(({ data }: { data: { status: typeof paymentStatus } }) => {
    paymentStatus = data.status;
    return Promise.resolve({ id: 'payment-unit' });
  });
  mocks.paymentUpdateMany.mockImplementation(({ data, where }: { data: { status: typeof paymentStatus }; where: { status: { not?: string; notIn?: string[] } } }) => {
    if (paymentStatus === where.status.not || where.status.notIn?.includes(paymentStatus)) return Promise.resolve({ count: 0 });
    paymentStatus = data.status;
    return Promise.resolve({ count: 1 });
  });
  type BookingWrite = Omit<Partial<BookingState>, 'version' | 'totalPence'> & { version?: number | { increment: number }; totalPence?: number | { increment: number } };
  mocks.bookingUpdate.mockImplementation(({ data }: { data: BookingWrite }) => {
    const { version, totalPence, ...rest } = data;
    booking = { ...booking, ...rest,
      version: typeof version === 'object' ? booking.version + version.increment : version ?? booking.version,
      totalPence: typeof totalPence === 'object' ? booking.totalPence + totalPence.increment : totalPence ?? booking.totalPence,
    };
    return Promise.resolve(booking);
  });
  mocks.bookingUpdateMany.mockImplementation(() => {
    if (!booking.deletedAt) return Promise.resolve({ count: 0 });
    booking.deletedAt = null;
    booking.version += 1;
    return Promise.resolve({ count: 1 });
  });
  mocks.stripeEventFindUnique.mockResolvedValue(null);
  mocks.extraChargeUpdate.mockImplementation(() => { extraChargeStatus = 'PAID'; return Promise.resolve({ id: 'extra-unit' }); });
  mocks.slotHoldFindUnique.mockResolvedValue(null);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('payment events cannot silently hide active money or resurrect removed history', () => {
  it('atomically reconciles a genuine late initial payment and clears the removal marker', async () => {
    expect(await handleStripeEvent(event('payment_intent.succeeded'), now)).toBe('processed');
    expect(booking).toMatchObject({ status: 'CONFIRMED', deletedAt: null, holdExpiresAt: null });
    expect(paymentStatus).toBe('SUCCEEDED');
    expect(mocks.paymentUpdate).toHaveBeenCalledWith({ data: { status: 'SUCCEEDED', stripeChargeId: 'charge-unit', stripePaymentIntentId: 'pi_unit' }, where: { id: 'payment-unit' } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recompute).toHaveBeenCalledExactlyOnceWith(tx, 'booking-unit');
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, 'booking.confirmed', { bookingId: 'booking-unit' }, 'booking.confirmed:booking-unit');
  });

  it('unhides a genuinely paid expired booking even when the slot is gone and a refund is required', async () => {
    booking.status = 'EXPIRED';
    mocks.capacity.mockRejectedValue(new AppError('SLOT_UNAVAILABLE', 'Unit test occupied slot'));
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(booking).toMatchObject({ status: 'EXPIRED', deletedAt: null });
    expect(paymentStatus).toBe('SUCCEEDED');
    expect(mocks.refund).toHaveBeenCalledWith(tx, 'booking-unit', 10000, 'Paid after the booking hold expired.', { dedupePrefix: 'late-payment-refund', notifyCustomer: false });
  });

  it.each(['COMPLETED', 'CANCELLED', 'EXPIRED'] as const)('does not resurrect already-paid removed %s history on another success event', async (status) => {
    booking.status = status;
    paymentStatus = 'SUCCEEDED';
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(booking).toMatchObject({ status, deletedAt: now });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('preserves an in-progress job instead of downgrading it to confirmed on a repeated paid event', async () => {
    booking.status = 'IN_PROGRESS';
    booking.deletedAt = null;
    paymentStatus = 'SUCCEEDED';
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(booking.status).toBe('IN_PROGRESS');
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
  });

  it('makes a genuine processing transition visible without confirming the booking or changing money', async () => {
    paymentStatus = 'REQUIRES_PAYMENT';
    await handleStripeEvent(event('payment_intent.processing'), now);
    expect(paymentStatus).toBe('PROCESSING');
    expect(booking).toMatchObject({ deletedAt: null, status: 'CANCELLED' });
    expect(mocks.bookingUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(['payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled'] as const)('does not downgrade succeeded payment or reopen removed history on stale %s', async (type) => {
    paymentStatus = 'SUCCEEDED';
    booking.status = 'COMPLETED';
    await handleStripeEvent(event(type), now);
    expect(paymentStatus).toBe('SUCCEEDED');
    expect(booking).toMatchObject({ status: 'COMPLETED', deletedAt: now });
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'payment-unit', status: { notIn: ['SUCCEEDED', 'CANCELED'] } } }));
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it.each(['payment_intent.processing', 'payment_intent.payment_failed'] as const)('preserves proven cancellation and cleanup against a delayed older %s', async (type) => {
    paymentStatus = 'CANCELED';
    await handleStripeEvent(event(type), now);
    expect(paymentStatus).toBe('CANCELED');
    expect(booking).toMatchObject({ status: 'CANCELLED', deletedAt: now });
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('keeps existing processed-event replay idempotency', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ processedAt: now });
    expect(await handleStripeEvent(event('payment_intent.succeeded'), now)).toBe('replay');
    expect(mocks.paymentFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('resumes an unfinished terminal extra charge after success persistence succeeded but business application failed', async () => {
    paymentKind = 'EXTRA_CHARGE';
    booking.status = 'COMPLETED';
    mocks.paymentFindUnique.mockRejectedValueOnce(new Error('Unit-test transaction failure before extra application'));
    await expect(handleStripeEvent(event('payment_intent.succeeded'), now)).rejects.toThrow('Unit-test transaction failure');
    expect(paymentStatus).toBe('SUCCEEDED');
    expect(extraChargeStatus).toBe('AWAITING_PAYMENT');
    expect(booking.totalPence).toBe(20000);
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(extraChargeStatus).toBe('PAID');
    expect(booking).toMatchObject({ status: 'COMPLETED', deletedAt: null, totalPence: 30000 });
    expect(mocks.extraChargeUpdate).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, 'booking.extra_paid', { bookingId: 'booking-unit', paymentId: 'payment-unit' }, 'booking.extra_paid:payment-unit');
    // A different, delayed success event for already reconciled paid history must not undo later cleanup.
    booking.deletedAt = now;
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(booking.deletedAt).toBe(now);
    expect(booking.totalPence).toBe(30000);
    expect(mocks.extraChargeUpdate).toHaveBeenCalledOnce();
  });

  it('resumes an unfinished reschedule on success retry and does not repeat an already consumed hold', async () => {
    paymentKind = 'RESCHEDULE_DIFFERENCE';
    booking.status = 'CANCELLED';
    const hold = { id: 'hold-unit', bookingId: 'booking-unit', blocksSlots: 1, capacityUnits: 1,
      date: new Date('2031-03-03T00:00:00.000Z'), expiresAt: new Date(now.getTime() + 900_000), slot: 'MORNING' };
    mocks.slotHoldFindUnique.mockResolvedValue(hold);
    mocks.paymentFindUnique.mockRejectedValueOnce(new Error('Unit-test transaction failure before reschedule application'));
    await expect(handleStripeEvent(event('payment_intent.succeeded'), now)).rejects.toThrow('Unit-test transaction failure');
    expect(paymentStatus).toBe('SUCCEEDED');
    expect(mocks.slotHoldDelete).not.toHaveBeenCalled();
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(mocks.slotHoldDelete).toHaveBeenCalledExactlyOnceWith({ where: { id: 'hold-unit' } });
    expect(booking).toMatchObject({ status: 'CANCELLED', deletedAt: null, moveDate: hold.date, totalPence: 30000 });
    mocks.slotHoldFindUnique.mockResolvedValue(null);
    booking.deletedAt = now;
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(booking.deletedAt).toBe(now);
    expect(booking.totalPence).toBe(30000);
    expect(mocks.slotHoldDelete).toHaveBeenCalledOnce();
  });

  it('does not reopen later cleanup when a delayed duplicate holds a stale pre-transaction unpaid snapshot', async () => {
    paymentKind = 'EXTRA_CHARGE';
    paymentStatus = 'SUCCEEDED';
    extraChargeStatus = 'PAID';
    booking.status = 'COMPLETED';
    mocks.paymentFindFirst.mockResolvedValue({
      id: 'payment-unit', bookingId: 'booking-unit', amountPence: 10000,
      kind: 'EXTRA_CHARGE', status: 'REQUIRES_PAYMENT', booking: { ...booking },
    });
    await handleStripeEvent(event('payment_intent.succeeded'), now);
    expect(mocks.paymentUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'payment-unit', status: { not: 'SUCCEEDED' } }, data: { status: 'SUCCEEDED' } });
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.extraChargeUpdate).not.toHaveBeenCalled();
    expect(booking).toMatchObject({ status: 'COMPLETED', deletedAt: now, totalPence: 20000 });
  });
});
