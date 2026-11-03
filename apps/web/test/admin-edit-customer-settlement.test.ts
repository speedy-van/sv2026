import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  booking: vi.fn(), bookingUpdate: vi.fn(), pendingExtra: vi.fn(), pendingRefund: vi.fn(),
  extra: vi.fn(), manual: vi.fn(), createPayment: vi.fn(), createIntent: vi.fn(), verifyPay: vi.fn(),
  settings: vi.fn(), refund: vi.fn(), enqueue: vi.fn(), transaction: vi.fn(), paymentUpdate: vi.fn(),
}));
vi.mock('@sv/db', () => {
  const db = {
    booking: { findUniqueOrThrow: mocks.booking, update: mocks.bookingUpdate },
    extraCharge: { findFirst: mocks.pendingExtra, findUnique: mocks.extra },
    refund: { findFirst: mocks.pendingRefund }, manualQuote: { findUnique: mocks.manual },
    payment: { create: mocks.createPayment, update: vi.fn(), updateMany: mocks.paymentUpdate },
  };
  return { Prisma: {}, assertSlotCapacity: vi.fn(), enqueueOutbox: mocks.enqueue, prisma: { ...db, $transaction: (run: (tx: typeof db) => Promise<unknown>, options: unknown) => { mocks.transaction(options); return run(db); } } };
});
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings, getOperationsSettings: vi.fn() }));
vi.mock('../src/server/integrations/stripe', () => ({ createOrRetrievePaymentIntent: mocks.createIntent }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund }));
vi.mock('../src/server/auth/customer-links', () => ({
  verifyBookingLink: vi.fn().mockResolvedValue({ bookingId: 'booking-edit' }), verifyCustomerLink: mocks.verifyPay,
  contactEmailHash: () => 'email-hash', bookingPurposeLink: vi.fn(), manageLinkForBooking: vi.fn(), signCustomerLink: vi.fn(),
}));
import { applyCancel, payRequestView, previewCancel, previewReschedule, startPayRequest } from '../src/server/services/customer-self-service';

const now = new Date('2031-01-01T12:00:00Z');
const booking = { id: 'booking-edit', reference: 'SV-EDIT', status: 'CONFIRMED', jobStage: 'NOT_STARTED', moveDate: new Date('2031-01-10T00:00:00Z'), slot: 'MORNING', paidPence: 10000, refundedPence: 0, contactEmail: 'customer@example.test', deletedAt: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.booking.mockResolvedValue({ ...booking });
  mocks.pendingExtra.mockResolvedValue(null);
  mocks.pendingRefund.mockResolvedValue(null);
  mocks.manual.mockResolvedValue(null);
  mocks.extra.mockResolvedValue({ id: 'extra-edit', bookingId: booking.id, booking: { ...booking }, status: 'AWAITING_PAYMENT', includedInBookingTotal: true, amountPence: 2000, description: 'Move change', payment: null });
  mocks.verifyPay.mockResolvedValue({ subject: 'extra-edit', emailHash: 'email-hash' });
  mocks.settings.mockResolvedValue({ freeCancellationHours: 48, noRefundHours: 24, lateCancellationRefundPercent: 50 });
  mocks.createPayment.mockResolvedValue({ id: 'payment-edit', bookingId: booking.id, amountPence: 2000, currency: 'gbp', kind: 'EXTRA_CHARGE', stripePaymentIntentId: 'pi_edit' });
  mocks.createIntent.mockResolvedValue({ id: 'pi_edit', clientSecret: 'test-client-secret' });
  mocks.paymentUpdate.mockResolvedValue({ count: 1 });
});

describe('customer actions while an admin change is settling', () => {
  it.each(['extra', 'refund'])('blocks cancellation with a pending %s without making any payment or mutation', async (kind) => {
    (kind === 'extra' ? mocks.pendingExtra : mocks.pendingRefund).mockResolvedValue({ id: 'pending-edit' });
    expect(await previewCancel('manage-token', now)).toMatchObject({ allowed: false, refundPence: 0 });
    await expect(applyCancel('manage-token', { expectedRefundPence: 10000 }, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
  it('rechecks a newly created edit charge inside the cancellation transaction', async () => {
    mocks.pendingExtra.mockResolvedValueOnce(null).mockResolvedValue({ id: 'new-edit-charge' });
    await expect(applyCancel('manage-token', { expectedRefundPence: 10000 }, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.transaction).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
  it('requires a fresh confirmation if a payment changes the refund during cancellation', async () => {
    mocks.booking.mockResolvedValueOnce({ ...booking }).mockResolvedValue({ ...booking, paidPence: 12000 });
    await expect(applyCancel('manage-token', { expectedRefundPence: 10000 }, now)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('allows a settled booking to follow the configured cancellation policy', async () => {
    await expect(applyCancel('manage-token', { expectedRefundPence: 10000 }, now)).resolves.toEqual({ refundPence: 10000 });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({ where: { id: booking.id }, data: {
      cancelledAt: now, cancelledBy: 'CUSTOMER', cancelReason: null, status: 'CANCELLED', version: { increment: 1 },
    } });
    expect(mocks.refund).toHaveBeenCalledWith(expect.anything(), booking.id, 10000, 'Customer cancellation.', expect.anything());
  });
  it('blocks customer rescheduling until the admin change is settled', async () => {
    mocks.pendingExtra.mockResolvedValue({ id: 'pending-edit' });
    await expect(previewReschedule('manage-token', { date: '2031-01-11', slot: 'MORNING' }, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
});

describe('admin edit payment links', () => {
  it.each(['CANCELLED', 'EXPIRED'])('expires and blocks payment links for a %s booking', async (status) => {
    mocks.extra.mockResolvedValue({ status: 'AWAITING_PAYMENT', booking: { ...booking, status }, amountPence: 2000 });
    expect(await payRequestView('pay-token', now)).toMatchObject({ expired: true, paid: false });
    await expect(startPayRequest('pay-token', now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
  it.each(['REQUESTED', 'REJECTED', 'CANCELED', 'PAID'])('does not create a payment for a %s charge', async (status) => {
    mocks.extra.mockResolvedValue({ status, booking: { ...booking }, amountPence: 2000 });
    await expect(startPayRequest('pay-token', now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
  it('still allows payment of an approved change on a live booking', async () => {
    await expect(startPayRequest('pay-token', now)).resolves.toEqual({ amountPence: 2000, clientSecret: 'test-client-secret', paymentId: 'payment-edit' });
    expect(mocks.createPayment).toHaveBeenCalledOnce();
    expect(mocks.createIntent).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
  });
  it('rechecks revocation before creating a Stripe intent', async () => {
    mocks.extra.mockResolvedValueOnce({ id: 'extra-edit', status: 'AWAITING_PAYMENT', booking: { ...booking }, amountPence: 2000 })
      .mockResolvedValue({ id: 'extra-edit', status: 'CANCELED', booking: { ...booking }, amountPence: 2000 });
    await expect(startPayRequest('pay-token', now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
});
