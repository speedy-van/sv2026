import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ manual: vi.fn(), extra: vi.fn(), booking: vi.fn(), intent: vi.fn(), persist: vi.fn(), cancel: vi.fn(), createPayment: vi.fn(), settings: vi.fn(), operations: vi.fn(), verify: vi.fn(), transaction: vi.fn() }));
vi.mock('@sv/db', () => {
  const tx = { manualQuote: { findUnique: mocks.manual }, extraCharge: { findUnique: mocks.extra }, booking: { findUnique: mocks.booking }, payment: { create: mocks.createPayment, updateMany: mocks.persist } };
  return { Prisma: {}, assertSlotCapacity: vi.fn(), enqueueOutbox: vi.fn(), prisma: { ...tx, $transaction: (run: (client: typeof tx) => Promise<unknown>, options: unknown) => { mocks.transaction(options); return run(tx); } } };
});
vi.mock('../src/server/auth/customer-links', () => ({ verifyCustomerLink: mocks.verify, contactEmailHash: () => 'hash', bookingPurposeLink: vi.fn(), manageLinkForBooking: vi.fn(), signCustomerLink: vi.fn(), verifyBookingLink: vi.fn() }));
vi.mock('../src/server/integrations/stripe', () => ({ createOrRetrievePaymentIntent: mocks.intent, cancelPaymentIntentForCleanup: mocks.cancel }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: mocks.operations, getSetting: mocks.settings }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: vi.fn() }));
import { startPayRequest } from '../src/server/services/customer-self-service';
const now = new Date('2031-01-01T12:00:00Z');
beforeEach(() => {
  vi.resetAllMocks(); mocks.manual.mockResolvedValue(null); mocks.extra.mockResolvedValue(null); mocks.verify.mockResolvedValue({ subject: 'booking-1', emailHash: 'hash' });
  mocks.booking.mockResolvedValue({ id: 'booking-1', status: 'PENDING_PAYMENT', deletedAt: null, contactEmail: 'test@example.test', reference: 'SV-TEST12', totalPence: 10000, holdExpiresAt: new Date('2031-01-02'), payments: [{ id: 'payment-1', kind: 'ADMIN_BOOKING', status: 'REQUIRES_PAYMENT', amountPence: 10000, bookingId: 'booking-1', currency: 'gbp', stripePaymentIntentId: null }] });
  mocks.persist.mockResolvedValue({ count: 1 }); mocks.intent.mockResolvedValue({ id: 'pi-new', clientSecret: 'secret' });
  mocks.operations.mockResolvedValue({ minLeadMinutes: 60, bookingPaused: false, slotWindows: { MORNING: { start: '08:00' } } });
});
describe('payment links versus administrative changes', () => {
  it('claims a live phone payment with a conditional status before returning the intent', async () => {
    expect(await startPayRequest('token', now)).toEqual({ amountPence: 10000, clientSecret: 'secret', paymentId: 'payment-1' });
    expect(mocks.transaction).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
    expect(mocks.persist).toHaveBeenCalledWith(contains({ where: contains({ status: { in: ['REQUIRES_PAYMENT','FAILED'] }, booking: contains({ status: { in: ['PENDING_PAYMENT'] } }) }) }));
  });
  it('closes the new Stripe intent when cancellation or offline settlement wins the race', async () => {
    mocks.persist.mockResolvedValue({ count: 0 });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).toHaveBeenCalledWith('pi-new', { bookingId: 'booking-1', paymentId: 'payment-1' });
  });
  it('refuses expired phone holds before calling Stripe', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-1', contactEmail: 'test@example.test', status: 'PENDING_PAYMENT', holdExpiresAt: new Date('2030-01-01'), payments: [] });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('reuses the original web payment when the admin resends a payment link', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-1', status: 'PENDING_PAYMENT', contactEmail: 'test@example.test', reference: 'SV-TEST12', totalPence: 10000, holdExpiresAt: new Date('2031-01-02'), payments: [{ id: 'web-payment', kind: 'BOOKING', status: 'REQUIRES_PAYMENT', amountPence: 10000, bookingId: 'booking-1', currency: 'gbp', stripePaymentIntentId: 'pi-original' }] });
    expect(await startPayRequest('token', now)).toMatchObject({ paymentId: 'web-payment' });
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
  it('does not create a second payment while the original capture is processing', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-1', status: 'PENDING_PAYMENT', contactEmail: 'test@example.test', holdExpiresAt: new Date('2031-01-02'), payments: [{ id: 'web-payment', kind: 'BOOKING', status: 'PROCESSING' }] });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createPayment).not.toHaveBeenCalled(); expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('rejects a manual quote that was declined after the payment page opened', async () => {
    mocks.manual.mockResolvedValue({ id: 'manual-1', contactEmail: 'test@example.test', status: 'DECLINED' });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('rechecks a manual quotes latest revision inside its serializable transaction', async () => {
    const manual = { id: 'manual-1', contactEmail: 'test@example.test', status: 'PRICED', pricePence: 10000, preferredDate: new Date('2031-01-02'), preferredSlot: 'MORNING', validUntil: new Date('2031-01-03'), updatedAt: now, quote: { service: 'man-and-van' } };
    mocks.manual.mockResolvedValueOnce(manual).mockResolvedValue({ ...manual, updatedAt: new Date(now.getTime() + 1) });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('rejects a manual quote after its move cutoff even when the old link expiry is later', async () => {
    mocks.manual.mockResolvedValue({ id: 'manual-1', contactEmail: 'test@example.test', status: 'PRICED', pricePence: 10000, preferredDate: new Date('2031-01-01'), preferredSlot: 'MORNING', validUntil: new Date('2031-01-03'), updatedAt: now, quote: { service: 'man-and-van' } });
    await expect(startPayRequest('token', now)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.intent).not.toHaveBeenCalled();
  });
});

function contains(value: unknown): unknown { return expect.objectContaining(value); }
