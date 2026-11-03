import type { DbTx } from '@sv/db';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ payments: vi.fn(), createRefund: vi.fn(), outbox: vi.fn(), stripe: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: mocks.outbox }));
vi.mock('../src/server/integrations/stripe', () => ({ createStripeRefund: mocks.stripe }));
import { requestRefund } from '../src/server/services/payments';

interface Payment {
  id: string; amountPence: number;
  refunds: { amountPence: number; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' }[];
}
const tx = { payment: { findMany: mocks.payments }, refund: { create: mocks.createRefund } } as unknown as DbTx;
const ledger: Payment[] = [
  { id: 'newer-unrelated-payment', amountPence: 5000, refunds: [] },
  { id: 'cancelled-edit-payment', amountPence: 2500, refunds: [] },
  { id: 'original-booking-payment', amountPence: 10000, refunds: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.payments.mockImplementation((query: { where: { id?: string } }) => Promise.resolve(ledger.filter((payment) => !query.where.id || payment.id === query.where.id)));
  let sequence = 0;
  mocks.createRefund.mockImplementation(() => Promise.resolve({ id: `refund-${String(++sequence)}` }));
});

it('allocates a late admin-edit refund exclusively to the specified captured payment', async () => {
  await requestRefund(tx, 'booking', 2500, 'Late cancelled edit', { paymentId: 'cancelled-edit-payment', dedupePrefix: 'cancelled-admin-edit:cancelled-edit-payment' });
  expect(mocks.payments).toHaveBeenCalledExactlyOnceWith({ orderBy: { createdAt: 'desc' },
    where: { bookingId: 'booking', method: 'STRIPE', status: 'SUCCEEDED', id: 'cancelled-edit-payment' },
    select: { amountPence: true, id: true, refunds: { select: { amountPence: true, status: true } } },
  });
  expect(mocks.createRefund).toHaveBeenCalledExactlyOnceWith({
    data: { amountPence: 2500, paymentId: 'cancelled-edit-payment', reason: 'Late cancelled edit' }, select: { id: true },
  });
  expect(mocks.outbox).toHaveBeenCalledExactlyOnceWith(tx, 'payment.refund',
    { bookingId: 'booking', notifyCustomer: true, refundId: 'refund-1' }, 'cancelled-admin-edit:cancelled-edit-payment:refund-1');
  expect(mocks.stripe).not.toHaveBeenCalled();
});

it('never falls back to another booking payment when the scoped payment is already fully refunded', async () => {
  mocks.payments.mockResolvedValue([{ id: 'cancelled-edit-payment', amountPence: 2500, refunds: [{ amountPence: 2500, status: 'PENDING' }] }]);
  await expect(requestRefund(tx, 'booking', 2500, 'Late cancelled edit', { paymentId: 'cancelled-edit-payment' }))
    .rejects.toMatchObject({ code: 'PAYMENT_FAILED', details: { remainingPence: 2500 } });
  expect(mocks.payments).toHaveBeenCalledOnce(); expect(mocks.createRefund).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
});

it('rejects a missing scoped payment without allocating against other payments', async () => {
  await expect(requestRefund(tx, 'booking', 2500, 'Late cancelled edit', { paymentId: 'missing-payment' }))
    .rejects.toMatchObject({ code: 'PAYMENT_FAILED', details: { remainingPence: 2500 } });
  expect(mocks.createRefund).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
});

it('reserves pending and completed refunds while allowing failed or cancelled amounts to be refunded again', async () => {
  mocks.payments.mockResolvedValue([{ id: 'cancelled-edit-payment', amountPence: 5000, refunds: [
    { amountPence: 1000, status: 'PENDING' }, { amountPence: 1000, status: 'SUCCEEDED' },
    { amountPence: 500, status: 'FAILED' }, { amountPence: 500, status: 'CANCELED' },
  ] }]);
  await requestRefund(tx, 'booking', 3000, 'Remaining captured money', { paymentId: 'cancelled-edit-payment', notifyCustomer: false });
  expect(mocks.createRefund).toHaveBeenCalledExactlyOnceWith({ data: { amountPence: 3000, paymentId: 'cancelled-edit-payment', reason: 'Remaining captured money' }, select: { id: true } });
  expect(mocks.outbox).toHaveBeenCalledExactlyOnceWith(tx, 'payment.refund', { bookingId: 'booking', notifyCustomer: false, refundId: 'refund-1' }, 'payment.refund:refund-1');
});

it('preserves newest-first allocation across multiple captured payments when no payment scope is requested', async () => {
  await requestRefund(tx, 'booking', 6000, 'Cancellation');
  expect(mocks.createRefund).toHaveBeenNthCalledWith(1, { data: { amountPence: 5000, paymentId: 'newer-unrelated-payment', reason: 'Cancellation' }, select: { id: true } });
  expect(mocks.createRefund).toHaveBeenNthCalledWith(2, { data: { amountPence: 1000, paymentId: 'cancelled-edit-payment', reason: 'Cancellation' }, select: { id: true } });
  expect(mocks.stripe).not.toHaveBeenCalled();
});

it.each([0, -1])('does not create a refund or contact Stripe for amount %i', async (amount) => {
  await requestRefund(tx, 'booking', amount, 'No refund');
  expect(mocks.payments).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled(); expect(mocks.stripe).not.toHaveBeenCalled();
});
