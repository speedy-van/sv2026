import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batch: vi.fn(), capture: vi.fn(), payment: vi.fn(), events: vi.fn(), refunds: vi.fn(), receipts: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/notifications/receipt-maintenance', () => ({ maintainPushReceipts: mocks.receipts }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));
vi.mock('@sv/db', () => ({
  prisma: { payment: { findFirst: mocks.payment }, outboxEvent: { findMany: mocks.events }, refund: { findMany: mocks.refunds } },
}));
import { dispatchPendingOutbox } from '../src/server/outbox/dispatch';

const dispatchTypes = ['booking.confirmed', 'booking.rescheduled', 'booking.extra_paid', 'payment.refund',
  'payment.refund.created', 'payment.after_expiry_refunded', 'notification.create', 'push.send', 'email.send'];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.payment.mockResolvedValue({ id: 'payment-unit', bookingId: 'booking-unit', kind: 'BOOKING' });
  mocks.events.mockResolvedValue([{ id: 'confirmation-unit' }]);
  mocks.refunds.mockResolvedValue([]);
  mocks.batch.mockResolvedValue({ done: 0, failed: 0 });
  mocks.receipts.mockResolvedValue(undefined);
});

describe('bounded payment-scoped post-response outbox dispatcher', () => {
  it('resolves the exact succeeded payment and scopes every claim to a derived event root', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 1, failed: 0 });
    await dispatchPendingOutbox('pi_unit');
    expect(mocks.payment).toHaveBeenCalledExactlyOnceWith({
      where: { stripePaymentIntentId: 'pi_unit', status: 'SUCCEEDED', booking: { deletedAt: null } },
      select: { id: true, bookingId: true, kind: true },
    });
    expect(mocks.events).toHaveBeenCalledExactlyOnceWith({
      where: { OR: [
        { dedupeKey: 'booking.confirmed:booking-unit', type: 'booking.confirmed' },
        { dedupeKey: 'payment.after_expiry_refunded:payment-unit', type: 'payment.after_expiry_refunded' },
      ] },
      select: { id: true }, take: 25,
    });
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    for (const call of mocks.batch.mock.calls) expect(call).toEqual([1, dispatchTypes, { rootEventId: 'confirmation-unit' }]);
    expect(mocks.receipts).toHaveBeenCalledOnce();
    expect(mocks.receipts.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.batch.mock.invocationCallOrder.at(-1) ?? 0);
  });

  it.each([
    ['RESCHEDULE_DIFFERENCE', 'booking.rescheduled:payment-unit', 'booking.rescheduled'],
    ['EXTRA_CHARGE', 'booking.extra_paid:payment-unit', 'booking.extra_paid'],
  ])('uses the exact %s payment event instead of an unrelated booking confirmation', async (kind, dedupeKey, type) => {
    mocks.payment.mockResolvedValue({ id: 'payment-unit', bookingId: 'booking-unit', kind });
    await dispatchPendingOutbox('pi_unit');
    expect(mocks.events).toHaveBeenCalledWith({
      where: { OR: [{ dedupeKey, type },
        { dedupeKey: 'payment.after_expiry_refunded:payment-unit', type: 'payment.after_expiry_refunded' }] },
      select: { id: true }, take: 25,
    });
  });

  it('attempts only refunds belonging to the exact payment before querying its late-payment/refund notification events', async () => {
    mocks.refunds.mockResolvedValue([{ id: 'refund-unit' }]);
    mocks.events.mockResolvedValueOnce([{ id: 'refund-root' }]).mockResolvedValueOnce([{ id: 'late-root' }, { id: 'refund-created-root' }]);
    await dispatchPendingOutbox('pi_expired');
    expect(mocks.refunds).toHaveBeenCalledWith({ where: { paymentId: 'payment-unit' }, select: { id: true }, take: 20 });
    expect(mocks.events).toHaveBeenNthCalledWith(1, {
      where: { type: 'payment.refund', dedupeKey: { in: [
        'late-payment-refund:refund-unit', 'expired-reschedule-refund:refund-unit', 'taken-reschedule-refund:refund-unit',
      ] } }, select: { id: true }, take: 20,
    });
    expect(mocks.batch.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      { rootEventId: 'refund-root' }, { rootEventId: 'late-root' }, { rootEventId: 'refund-created-root' },
    ]);
  });

  it('does not read or drain any queue for a missing or unpaid payment', async () => {
    mocks.payment.mockResolvedValue(null);
    await dispatchPendingOutbox('pi_unmatched');
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.refunds).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
  });

  it('does not dispatch when no derived event roots exist', async () => {
    mocks.events.mockResolvedValue([]);
    await dispatchPendingOutbox('pi_unit');
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('stops after twelve single-job claims and leaves the remainder durable', async () => {
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    await dispatchPendingOutbox('pi_unit');
    expect(mocks.batch).toHaveBeenCalledTimes(12);
  });

  it('does not claim another job after the between-job time budget expires', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(40_001);
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    try {
      await dispatchPendingOutbox('pi_unit');
      expect(mocks.batch).toHaveBeenCalledTimes(1);
      expect(mocks.receipts).not.toHaveBeenCalled();
    }
    finally { clock.mockRestore(); }
  });

  it('awaits the active claim before finishing', async () => {
    let finish: ((result: { done: number; failed: number }) => void) | undefined;
    mocks.batch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let settled = false;
    const task = dispatchPendingOutbox('pi_unit').then(() => { settled = true; });
    await vi.waitFor(() => { expect(mocks.batch).toHaveBeenCalledTimes(1); });
    expect(settled).toBe(false);
    if (!finish) throw new Error('Expected an active outbox claim.');
    finish({ done: 0, failed: 0 }); await task; expect(settled).toBe(true);
  });

  it('reports infrastructure failures without failing an already committed payment webhook', async () => {
    const error = new Error('Unit database unavailable'); mocks.batch.mockRejectedValue(error);
    await expect(dispatchPendingOutbox('pi_unit')).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(error, { tags: { feature: 'webhook-outbox-dispatch' } });
  });
});
