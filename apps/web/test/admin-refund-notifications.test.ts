import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
const mocks = vi.hoisted(() => ({ refund: vi.fn(), refundUpdate: vi.fn(), payments: vi.fn(), bookingUpdate: vi.fn(), createRefund: vi.fn(), enqueue: vi.fn(), event: vi.fn(), eventCreate: vi.fn(), eventUpdate: vi.fn() }));
vi.mock('@sv/db', () => {
  const tx = { refund: { findUnique: mocks.refund, update: mocks.refundUpdate, updateMany: mocks.refundUpdate }, payment: { findMany: mocks.payments }, booking: { update: mocks.bookingUpdate } };
  return { enqueueOutbox: mocks.enqueue, assertSlotCapacity: vi.fn(), prisma: { ...tx, stripeEvent: { findUnique: mocks.event, create: mocks.eventCreate, update: mocks.eventUpdate }, $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) } };
});
vi.mock('../src/server/integrations/stripe', () => ({ createStripeRefund: mocks.createRefund }));
import { prisma } from '@sv/db';
import { runRefundOutbox } from '../src/server/services/payments';
import { handleStripeEvent } from '../src/server/services/stripe-webhook';
beforeEach(() => { vi.resetAllMocks(); mocks.refundUpdate.mockResolvedValue({ count: 1 }); mocks.refund.mockResolvedValue({ id: 'refund-1', amountPence: 5000, status: 'PENDING', stripeRefundId: null, payment: { bookingId: 'booking-1', stripePaymentIntentId: 'pi-1' } }); mocks.payments.mockResolvedValue([{ amountPence: 10000, status: 'SUCCEEDED', refunds: [{ amountPence: 5000, status: 'SUCCEEDED' }] }]); mocks.createRefund.mockResolvedValue({ id: 're-1', status: 'SUCCEEDED' }); });
describe('refund notifications retain the administrative decision', () => {
  it('passes no-notification choice to the provider metadata and immediate completion', async () => {
    await runRefundOutbox(prisma, 'refund-1', { notifyCustomer: false });
    expect(mocks.createRefund).toHaveBeenCalledWith(expect.objectContaining({ notifyCustomer: false }));
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'payment.refund.created', { bookingId: 'booking-1', refundId: 'refund-1', notifyCustomer: false }, 'payment.refund.created:refund-1');
  });
  it('waits for the webhook before announcing a pending refund', async () => {
    mocks.createRefund.mockResolvedValue({ id: 're-1', status: 'PENDING' });
    await runRefundOutbox(prisma, 'refund-1', { notifyCustomer: false }); expect(mocks.enqueue).not.toHaveBeenCalled();
    const event = { id: 'evt-refund', type: 'refund.updated', data: { object: { id: 're-1', status: 'succeeded', metadata: { refundId: 'refund-1', notifyCustomer: 'false' } } } } as unknown as Stripe.Event;
    await handleStripeEvent(event);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'payment.refund.created', { bookingId: 'booking-1', refundId: 'refund-1', notifyCustomer: false }, 'payment.refund.created:refund-1');
  });
  it('defaults to notifying the customer for ordinary successful refunds', async () => {
    await runRefundOutbox(prisma, 'refund-1');
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'payment.refund.created', { bookingId: 'booking-1', refundId: 'refund-1', notifyCustomer: true }, 'payment.refund.created:refund-1');
  });
  it('does not regress a succeeded refund when an older pending webhook arrives', async () => {
    mocks.refundUpdate.mockResolvedValue({ count: 0 });
    const event = { id: 'evt-old-refund', type: 'refund.updated', data: { object: { id: 're-1', status: 'pending', metadata: { refundId: 'refund-1' } } } } as unknown as Stripe.Event;
    await handleStripeEvent(event);
    expect(mocks.refundUpdate).toHaveBeenCalledWith({ data: { status: 'PENDING', stripeRefundId: 're-1' }, where: { id: 'refund-1', status: { not: 'SUCCEEDED' } } });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
