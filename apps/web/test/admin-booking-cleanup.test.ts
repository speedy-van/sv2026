import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), transactionFindUnique: vi.fn(), updateMany: vi.fn(), paymentUpdateMany: vi.fn(),
  slotHoldDeleteMany: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(), cancel: vi.fn(),
}));
vi.mock('@sv/db', () => ({ prisma: { booking: { findUnique: mocks.findUnique }, $transaction: mocks.transaction } }));
vi.mock('../src/server/integrations/stripe', () => ({ cancelPaymentIntentForCleanup: mocks.cancel }));

import { bookingDeletionCapability, deleteAdminBooking, restoreAdminBooking } from '../src/server/admin/booking-cleanup';

type Booking = Parameters<typeof bookingDeletionCapability>[0];
type Payment = Booking['payments'][number];
const now = new Date('2031-03-01T12:00:00.000Z');
const staff = { userId: 'admin-unit', requestId: 'request-unit' };
const tx = {
  booking: { findUnique: mocks.transactionFindUnique, updateMany: mocks.updateMany },
  payment: { updateMany: mocks.paymentUpdateMany }, slotHold: { deleteMany: mocks.slotHoldDeleteMany },
  auditLog: { create: mocks.auditCreate },
};

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-unit', kind: 'BOOKING', method: 'STRIPE', status: 'REQUIRES_PAYMENT',
    stripePaymentIntentId: 'pi_unit', stripeCheckoutSessionId: null, stripeChargeId: null, refunds: [], extraCharge: null, ...overrides,
  };
}
function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-unit', status: 'PENDING_PAYMENT', jobStage: 'NOT_STARTED', dispatchStatus: 'UNASSIGNED', driverId: null,
    paidPence: 0, refundedPence: 0, holdExpiresAt: new Date(now.getTime() + 900_000), version: 3,
    deletedAt: null, payments: [payment()], slotHolds: [], ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue(booking());
  mocks.transactionFindUnique.mockResolvedValue(booking());
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.slotHoldDeleteMany.mockResolvedValue({ count: 0 });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('reversible admin booking cleanup', () => {
  it('proves cancellation before atomically canceling an unpaid pending booking and hiding its row', async () => {
    const result = await deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now);
    expect(result).toEqual({ id: 'booking-unit', deletedAt: now.toISOString(), version: 4, status: 'CANCELLED' });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('pi_unit', { bookingId: 'booking-unit', paymentId: 'payment-unit' });
    expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0] ?? Infinity);
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'booking-unit', version: 3, deletedAt: null, status: 'PENDING_PAYMENT', paidPence: 0, refundedPence: 0 },
      data: { deletedAt: now, status: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'ADMIN', version: { increment: 1 } },
    });
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({ where: { bookingId: 'booking-unit', status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } }, data: { status: 'CANCELED' } });
    expect(mocks.slotHoldDeleteMany).toHaveBeenCalledWith({ where: { bookingId: 'booking-unit' } });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate.mock.calls[0]?.[0]).toMatchObject({ data: {
      action: 'admin.bookings.delete', actorUserId: staff.userId, requestId: staff.requestId,
      before: { deletedAt: null, status: 'PENDING_PAYMENT', version: 3 }, after: { deletedAt: result.deletedAt, status: result.status, version: result.version },
    } });
  });

  it.each(['COMPLETED', 'CANCELLED', 'EXPIRED'] as const)('retains %s lifecycle and financial history while hiding it', async (status) => {
    const paid = booking({ status, jobStage: status === 'COMPLETED' ? 'COMPLETED' : 'NOT_STARTED', paidPence: 10000, refundedPence: 2500,
      payments: [payment({ status: 'SUCCEEDED', stripeChargeId: 'charge-unit', refunds: [{ id: 'refund-unit' }] })] });
    mocks.findUnique.mockResolvedValue(paid);
    mocks.transactionFindUnique.mockResolvedValue(paid);
    const result = await deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now);
    expect(result.status).toBe(status);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.updateMany.mock.calls[0]?.[0]).toHaveProperty('data', { deletedAt: now, version: { increment: 1 } });
  });

  it.each(['CONFIRMED', 'IN_PROGRESS'] as const)('rejects an active %s booking before external or database mutations', async (status) => {
    mocks.findUnique.mockResolvedValue(booking({ status }));
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const)('rejects any processing payment on %s', async (status) => {
    mocks.findUnique.mockResolvedValue(booking({ status, payments: [payment(), payment({ id: 'extra-payment', kind: 'EXTRA_CHARGE', status: 'PROCESSING' })] }));
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { paidPence: 1 }, { refundedPence: 1 }, { payments: [payment({ status: 'SUCCEEDED' })] },
    { payments: [payment({ stripeChargeId: 'charge-unit' })] }, { payments: [payment({ refunds: [{ id: 'refund-unit' }] })] },
    { jobStage: 'LOADING' }, { dispatchStatus: 'ACCEPTED' }, { driverId: 'driver-unit' },
    { payments: [payment({ stripePaymentIntentId: null })] }, { payments: [payment({ stripeCheckoutSessionId: 'checkout-unit' })] },
    { payments: [payment({ status: 'CANCELED', stripePaymentIntentId: null })] },
  ] satisfies Partial<Booking>[])('rejects unsafe pending state %# without canceling anything', async (overrides) => {
    mocks.findUnique.mockResolvedValue(booking(overrides));
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not hide a terminal booking while a paid slot change awaits reconciliation', () => {
    const current = booking({ status: 'EXPIRED', payments: [payment({ kind: 'RESCHEDULE_DIFFERENCE', status: 'SUCCEEDED' })], slotHolds: [{ paymentId: 'payment-unit' }] });
    expect(bookingDeletionCapability(current)).toMatchObject({ allowed: false });
  });

  it.each([null, { id: 'extra-unit', status: 'AWAITING_PAYMENT' }] as const)('does not hide newly succeeded extra-charge money before its charge is reconciled %#', (extraCharge) => {
    const current = booking({ status: 'COMPLETED', payments: [payment({ kind: 'EXTRA_CHARGE', status: 'SUCCEEDED', extraCharge })] });
    expect(bookingDeletionCapability(current)).toMatchObject({ allowed: false });
  });

  it('permits paid terminal extra-charge history once its charge is actually reconciled', () => {
    const current = booking({ status: 'COMPLETED', payments: [payment({ kind: 'EXTRA_CHARGE', status: 'SUCCEEDED', extraCharge: { id: 'extra-unit', status: 'PAID' } })] });
    expect(bookingDeletionCapability(current)).toEqual({ allowed: true, reason: null });
  });

  it('does not mutate the database when Stripe cancellation fails or races payment', async () => {
    mocks.cancel.mockRejectedValue(new AppError('CONFLICT', 'Payment is processing.'));
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('closes every outstanding Stripe attempt, including extra charges, before cleanup', async () => {
    const current = booking({ status: 'EXPIRED', payments: [payment(), payment({ id: 'extra-payment', kind: 'EXTRA_CHARGE', status: 'FAILED', stripePaymentIntentId: 'pi_extra' })] });
    mocks.findUnique.mockResolvedValue(current);
    mocks.transactionFindUnique.mockResolvedValue(current);
    await deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now);
    expect(mocks.cancel.mock.calls).toEqual([
      ['pi_unit', { bookingId: 'booking-unit', paymentId: 'payment-unit' }],
      ['pi_extra', { bookingId: 'booking-unit', paymentId: 'extra-payment' }],
    ]);
  });

  it('verifies even a locally canceled Stripe attempt rather than trusting a stale webhook status', async () => {
    const current = booking({ status: 'EXPIRED', payments: [payment({ status: 'CANCELED' })] });
    mocks.findUnique.mockResolvedValue(current);
    mocks.transactionFindUnique.mockResolvedValue(current);
    await deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('pi_unit', { bookingId: 'booking-unit', paymentId: 'payment-unit' });
  });

  it.each([
    { version: 4 }, { status: 'CONFIRMED' }, { payments: [payment({ status: 'PROCESSING' })] },
    { payments: [payment(), payment({ id: 'new-payment', stripePaymentIntentId: 'pi_new' })] },
  ] satisfies Partial<Booking>[])('rejects a change during cancellation %# before any transaction writes', async (overrides) => {
    mocks.transactionFindUnique.mockResolvedValue(booking(overrides));
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('fails the atomic conditional update without downstream mutations or a premature audit', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.slotHoldDeleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('treats repeated deletion as a no-op without repeating cancellation or audit', async () => {
    mocks.findUnique.mockResolvedValue(booking({ deletedAt: now, status: 'CANCELLED', version: 4 }));
    expect(await deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).toMatchObject({ deletedAt: now.toISOString(), version: 4 });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('restores only list visibility and never reinstates a payment, hold or booking status', async () => {
    mocks.transactionFindUnique.mockResolvedValue(booking({ deletedAt: now, status: 'CANCELLED', version: 4, holdExpiresAt: null }));
    const result = await restoreAdminBooking('booking-unit', { expectedVersion: 4 }, staff);
    expect(result).toEqual({ id: 'booking-unit', deletedAt: null, version: 5, status: 'CANCELLED' });
    expect(mocks.updateMany.mock.calls[0]?.[0]).toHaveProperty('data', { deletedAt: null, version: { increment: 1 } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.slotHoldDeleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate.mock.calls[0]?.[0]).toMatchObject({ data: { action: 'admin.bookings.restore' } });
  });

  it('treats repeated restore as a no-op and rejects a stale actual restore', async () => {
    expect(await restoreAdminBooking('booking-unit', { expectedVersion: 1 }, staff)).toMatchObject({ deletedAt: null, version: 3 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.transactionFindUnique.mockResolvedValue(booking({ deletedAt: now, version: 4 }));
    await expect(restoreAdminBooking('booking-unit', { expectedVersion: 3 }, staff)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a stale version before Stripe cancellation and reports missing bookings', async () => {
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 2 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue(null);
    await expect(deleteAdminBooking('missing', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    mocks.transactionFindUnique.mockResolvedValue(null);
    await expect(restoreAdminBooking('missing', { expectedVersion: 3 }, staff)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps a serializable transaction race to a refreshable conflict', async () => {
    mocks.transaction.mockRejectedValue({ code: 'P2034' });
    await expect(deleteAdminBooking('booking-unit', { expectedVersion: 3 }, staff, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(restoreAdminBooking('booking-unit', { expectedVersion: 3 }, staff)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
