import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';
const mocks = vi.hoisted(() => ({ update: vi.fn(), enqueue: vi.fn(), create: vi.fn(), booking: vi.fn(), pending: vi.fn(), manual: vi.fn(), quote: vi.fn(), users: vi.fn(), settings: vi.fn(), sendEmail: vi.fn(), refund: vi.fn(), ledgerUpdate: vi.fn() }));
vi.mock('@sv/db', () => {
  const tx = { booking: { findUnique: mocks.booking, findFirst: mocks.pending }, manualQuote: { findUnique: mocks.manual, findFirst: mocks.manual }, quote: { findUnique: mocks.quote }, user: { findMany: mocks.users }, outboxEvent: { update: mocks.update, create: mocks.create }, refund: { findUnique: mocks.refund }, mailDelivery: { updateMany: mocks.ledgerUpdate } };
  return { Prisma: { JsonNull: null }, enqueueOutbox: mocks.enqueue, prisma: { ...tx, $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) } };
});
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings }));
vi.mock('../src/server/auth/customer-links', () => ({ manageLinkForBooking: () => 'manage-token', bookingPurposeLink: () => 'track-token', contactEmailHash: (email: string) => `hash:${email}` }));
vi.mock('../src/server/services/customer-self-service', () => ({ payLinkForBooking: () => 'phone-pay-token', payLinkForManualQuote: () => 'manual-pay-token', payLinkForExtraCharge: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: vi.fn() }));
vi.mock('../src/server/integrations/mail', () => ({ sendTransactionalEmail: mocks.sendEmail }));
vi.mock('../src/server/mail/delivery', () => ({ processMailDelivery: vi.fn() }));
import { processOutboxEventNow } from '../src/server/outbox/processor';
const now = new Date('2031-01-01T12:00:00Z');
function booking() { return { id: 'booking-1', version: 4, status: 'PENDING_PAYMENT', deletedAt: null, holdExpiresAt: new Date('2031-01-02'), contactEmail: 'customer@example.test', contactName: 'Customer One', reference: 'SV-TEST12', moveDate: new Date('2031-01-10'), slot: 'MORNING', service: 'man-and-van', pricingVersion: { config: DEFAULT_PRICING_CONFIG }, totalPence: 10000, paidPence: 0, refundedPence: 0, pickup: { town: 'Glasgow' }, dropoff: null, completedAt: null, driverId: null }; }
function event(type: string, payload: unknown) { return { id: 'event-1', attempts: 1, type, payload }; }
function emailPayload(): unknown { return mocks.enqueue.mock.calls.find((args: unknown[]) => args[1] === 'email.send')?.[2]; }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.booking.mockResolvedValue(booking()); mocks.pending.mockResolvedValue({ id: 'booking-1' }); mocks.users.mockResolvedValue([]);
  mocks.manual.mockResolvedValue({ id: 'manual-1', quoteId: 'quote-1', status: 'PRICED', updatedAt: now, validUntil: new Date('2031-01-02'), contactEmail: 'customer@example.test', details: 'Original customer question', adminMessage: 'Price includes both trips.', pricePence: 25000 });
  mocks.quote.mockResolvedValue({ pickup: { town: 'Glasgow' }, dropoff: { town: 'Edinburgh' } });
  mocks.settings.mockImplementation((key: string) => Promise.resolve(key === 'web' ? { canonicalOrigin: 'https://example.test' } : key === 'company' ? { legalName: 'Company' } : { emailPublic: 'support@example.test', emailAdminAlerts: [] }));
});
afterEach(() => { vi.useRealTimers(); });
describe('admin action outbox expansion and final delivery', () => {
  it('suppresses a pending checkout alert after the booking has been paid or expired', async () => {
    mocks.update.mockResolvedValue(event('booking.pending_payment', { bookingId: 'booking-1' })); mocks.pending.mockResolvedValue(null);
    expect(await processOutboxEventNow('event-1')).toEqual({ done: 1, failed: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rechecks pending status before creating a delayed feed notification', async () => {
    mocks.update.mockResolvedValue(event('notification.create', { userId: 'admin-1', type: 'booking.pending_payment', title: 'Booking awaiting payment', body: 'Pending', data: { bookingId: 'booking-1' } }));
    mocks.pending.mockResolvedValue(null);
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 1, failed: 0 });
    expect(mocks.pending).toHaveBeenCalledOnce();
  });
  it('uses the payment-link template with the current booking token and delivery guard', async () => {
    mocks.update.mockResolvedValue(event('booking.payment_requested', { bookingId: 'booking-1', bookingVersion: 4 }));
    expect(await processOutboxEventNow('event-1')).toEqual({ done: 1, failed: 0 });
    expect(emailPayload()).toMatchObject({ template: 'payment-link', to: ['customer@example.test'], data: { payUrl: '/pay/phone-pay-token', amountPence: 10000 }, actionEmailGuard: { kind: 'booking', id: 'booking-1', version: 4, template: 'PAYMENT_LINK' } });
  });
  it('does not expand a payment email after cancellation', async () => {
    mocks.update.mockResolvedValue(event('booking.payment_requested', { bookingId: 'booking-1', bookingVersion: 4 })); mocks.booking.mockResolvedValue({ ...booking(), status: 'CANCELLED' });
    expect(await processOutboxEventNow('event-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('checks the payment guard again after expansion but before email delivery', async () => {
    mocks.update.mockResolvedValue(event('booking.payment_requested', { bookingId: 'booking-1', bookingVersion: 4 })); await processOutboxEventNow('event-1');
    mocks.update.mockResolvedValue(event('email.send', emailPayload())); mocks.booking.mockResolvedValue({ ...booking(), version: 5, status: 'CONFIRMED' });
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('suppresses an automatic booking confirmation if it is cancelled before delivery', async () => {
    mocks.booking.mockResolvedValue({ ...booking(), status: 'CONFIRMED', holdExpiresAt: null });
    mocks.update.mockResolvedValue(event('booking.confirmed', { bookingId: 'booking-1' })); await processOutboxEventNow('event-1');
    const payload = emailPayload();
    expect(payload).toMatchObject({ template: 'booking-confirmed', actionEmailGuard: { kind: 'booking-confirmation', id: 'booking-1' } });
    mocks.update.mockResolvedValue(event('email.send', payload)); mocks.booking.mockResolvedValue({ ...booking(), status: 'CANCELLED', version: 5 });
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('keeps automatic confirmations deliverable after a harmless version change', async () => {
    mocks.booking.mockResolvedValue({ ...booking(), status: 'CONFIRMED', holdExpiresAt: null });
    mocks.update.mockResolvedValue(event('booking.confirmed', { bookingId: 'booking-1' })); await processOutboxEventNow('event-1');
    mocks.update.mockResolvedValue(event('email.send', emailPayload())); mocks.booking.mockResolvedValue({ ...booking(), status: 'CONFIRMED', version: 5 });
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
  it.each(['booking.cancelled', 'payment.refund.created'])('honours notifyCustomer false for %s', async (type) => {
    mocks.update.mockResolvedValue(event(type, { bookingId: 'booking-1', notifyCustomer: false }));
    expect(await processOutboxEventNow('event-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('uses the admins quote message instead of the original enquiry and guards its revision', async () => {
    mocks.update.mockResolvedValue(event('manual_quote.priced', { manualQuoteId: 'manual-1', expectedUpdatedAt: now.toISOString() }));
    expect(await processOutboxEventNow('event-1')).toEqual({ done: 1, failed: 0 });
    expect(emailPayload()).toMatchObject({ template: 'manual-quote-ready', data: { message: 'Price includes both trips.', payUrl: '/pay/manual-pay-token', amountPence: 25000 }, actionEmailGuard: { kind: 'manual-quote', expectedUpdatedAt: now.toISOString(), status: 'PRICED' } });
  });
  it('drops a priced email when that manual quote changes before final delivery', async () => {
    mocks.update.mockResolvedValue(event('manual_quote.priced', { manualQuoteId: 'manual-1', expectedUpdatedAt: now.toISOString() })); await processOutboxEventNow('event-1');
    mocks.update.mockResolvedValue(event('email.send', emailPayload())); mocks.manual.mockResolvedValue({ status: 'PRICED', updatedAt: new Date(now.getTime() + 1), validUntil: new Date('2031-01-02') });
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 1, failed: 0 }); expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it('fails closed when an internal email guard is malformed', async () => {
    mocks.update.mockResolvedValue(event('email.send', { actionEmailGuard: { kind: 'booking' } }));
    expect(await processOutboxEventNow('channel-1')).toEqual({ done: 0, failed: 1 }); expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
