import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  bookingUpdateMany: vi.fn(),
  cancelPaymentIntent: vi.fn(),
  enqueueOutbox: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  slotHoldDeleteMany: vi.fn(),
  slotHoldFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@sv/db', () => ({
  enqueueOutbox: mocks.enqueueOutbox,
  prisma: {
    $transaction: mocks.transaction,
    booking: { findMany: mocks.bookingFindMany },
    payment: { findUnique: mocks.paymentFindUnique },
    slotHold: { findMany: mocks.slotHoldFindMany },
  },
}));
vi.mock('../src/server/integrations/stripe', () => ({ cancelPaymentIntent: mocks.cancelPaymentIntent }));

import { expireBookingHolds } from '../src/server/services/hold-expiry';

const tx = {
  booking: { updateMany: mocks.bookingUpdateMany },
  payment: { update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
  slotHold: { deleteMany: mocks.slotHoldDeleteMany },
};
const now = new Date('2031-03-01T12:00:00.000Z');
type PaymentStatus = 'REQUIRES_PAYMENT' | 'FAILED' | 'PROCESSING' | 'SUCCEEDED' | 'CANCELED';
type PaymentKind = 'BOOKING' | 'ADMIN_BOOKING' | 'MANUAL_QUOTE' | 'RESCHEDULE_DIFFERENCE' | 'EXTRA_CHARGE';

function payment(status: PaymentStatus, kind: PaymentKind = 'BOOKING', id = 'payment-checkout') {
  return { id, kind, status, stripePaymentIntentId: `pi_${id}` };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bookingFindMany.mockResolvedValue([]);
  mocks.slotHoldFindMany.mockResolvedValue([]);
  mocks.cancelPaymentIntent.mockResolvedValue('canceled');
  mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.slotHoldDeleteMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<void>) => operation(tx));
});

describe('initial checkout payment hold expiry', () => {
  it.each([
    ['BOOKING', 'PROCESSING'],
    ['BOOKING', 'SUCCEEDED'],
    ['ADMIN_BOOKING', 'PROCESSING'],
    ['ADMIN_BOOKING', 'SUCCEEDED'],
    ['MANUAL_QUOTE', 'PROCESSING'],
    ['MANUAL_QUOTE', 'SUCCEEDED'],
  ] as const)('leaves %s %s booking and payment untouched', async (kind, status) => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment(status, kind)] }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 0 });
    expect(mocks.bookingFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        payments: { select: { id: true, kind: true, status: true, stripePaymentIntentId: true } },
      },
      take: 50,
      where: { holdExpiresAt: { lt: now }, status: 'PENDING_PAYMENT' },
    });
    expect(mocks.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it('checks every initial payment before canceling another outstanding payment', async () => {
    mocks.bookingFindMany.mockResolvedValue([{
      id: 'booking-checkout',
      payments: [payment('REQUIRES_PAYMENT'), payment('PROCESSING', 'MANUAL_QUOTE', 'payment-processing')],
    }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['REQUIRES_PAYMENT', 'FAILED'] as const)('cancels %s before expiring its booking and deduplicated outbox event', async (status) => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment(status)] }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 1, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledWith('pi_payment-checkout');
    expect(mocks.cancelPaymentIntent.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0] ?? Infinity);
    expect(mocks.bookingUpdateMany).toHaveBeenCalledWith({
      data: { holdExpiresAt: null, status: 'EXPIRED' },
      where: { holdExpiresAt: { lt: now }, id: 'booking-checkout', status: 'PENDING_PAYMENT' },
    });
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({
      data: { status: 'CANCELED' },
      where: { bookingId: 'booking-checkout', status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } },
    });
    expect(mocks.enqueueOutbox).toHaveBeenCalledWith(
      tx,
      'booking.checkout_abandoned',
      { bookingId: 'booking-checkout' },
      'booking.checkout_abandoned:booking-checkout',
    );
  });

  it('expires an already canceled unpaid booking without canceling its intent again', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment('CANCELED')] }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 1, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.bookingUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.enqueueOutbox).toHaveBeenCalledOnce();
  });

  it('preserves expiry for an unpaid booking with no payment row', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [] }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 1, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.bookingUpdateMany).toHaveBeenCalledOnce();
  });

  it('retains the Stripe race check when an unpaid intent has just started processing or succeeded', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment('REQUIRES_PAYMENT')] }]);
    mocks.cancelPaymentIntent.mockResolvedValue('skip');
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledWith('pi_payment-checkout');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it('does not cancel payments or enqueue abandonment when the conditional booking update no longer matches', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment('FAILED')] }]);
    mocks.bookingUpdateMany.mockResolvedValue({ count: 0 });
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 0 });
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'SUCCEEDED'] as const)('does not let an unrelated extra charge %s block unpaid initial-payment expiry', async (status) => {
    mocks.bookingFindMany.mockResolvedValue([{
      id: 'booking-checkout',
      payments: [payment('REQUIRES_PAYMENT'), payment(status, 'EXTRA_CHARGE', 'payment-extra')],
    }]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 1, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledExactlyOnceWith('pi_payment-checkout');
  });

  it('continues expiring other unpaid bookings while leaving a processing booking intact', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 'booking-processing', payments: [payment('PROCESSING')] },
      { id: 'booking-unpaid', payments: [payment('FAILED', 'BOOKING', 'payment-unpaid')] },
    ]);
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 1, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledExactlyOnceWith('pi_payment-unpaid');
    expect(mocks.bookingUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.enqueueOutbox).toHaveBeenCalledWith(tx, 'booking.checkout_abandoned', { bookingId: 'booking-unpaid' }, 'booking.checkout_abandoned:booking-unpaid');
  });

  it('leaves the booking intact if intent cancellation cannot be verified', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ id: 'booking-checkout', payments: [payment('FAILED')] }]);
    mocks.cancelPaymentIntent.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'Stripe is temporarily unavailable.'));
    await expect(expireBookingHolds(now)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });
});

describe('existing reschedule slot-hold behavior', () => {
  it('retains a slot hold when Stripe says its payment must not be canceled', async () => {
    mocks.slotHoldFindMany.mockResolvedValue([{ id: 'slot-hold', paymentId: 'payment-reschedule' }]);
    mocks.paymentFindUnique.mockResolvedValue({ id: 'payment-reschedule', stripePaymentIntentId: 'pi_reschedule' });
    mocks.cancelPaymentIntent.mockResolvedValue('skip');
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 0 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledWith('pi_reschedule');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.slotHoldDeleteMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
  });

  it('expires an unpaid slot hold after canceling its intent', async () => {
    mocks.slotHoldFindMany.mockResolvedValue([{ id: 'slot-hold', paymentId: 'payment-reschedule' }]);
    mocks.paymentFindUnique.mockResolvedValue({ id: 'payment-reschedule', stripePaymentIntentId: 'pi_reschedule' });
    expect(await expireBookingHolds(now)).toEqual({ bookingsExpired: 0, slotHoldsExpired: 1 });
    expect(mocks.cancelPaymentIntent).toHaveBeenCalledWith('pi_reschedule');
    expect(mocks.slotHoldDeleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now }, id: 'slot-hold' } });
    expect(mocks.paymentUpdate).toHaveBeenCalledWith({ data: { status: 'CANCELED' }, where: { id: 'payment-reschedule' } });
  });
});
