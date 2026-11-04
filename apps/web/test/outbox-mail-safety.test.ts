import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), upsert: vi.fn(), email: vi.fn(), delivery: vi.fn(), ledgerUpdate: vi.fn(), transaction: vi.fn() }));
const tx = { outboxEvent: { update: mocks.update }, mailDelivery: { updateMany: mocks.ledgerUpdate } };
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null },
  enqueueOutbox: vi.fn(),
  prisma: { outboxEvent: { update: mocks.update, upsert: mocks.upsert }, $transaction: mocks.transaction },
}));
vi.mock('../src/server/integrations/mail', () => ({ sendTransactionalEmail: mocks.email }));
vi.mock('../src/server/mail/delivery', () => ({ processMailDelivery: mocks.delivery }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: vi.fn() }));
vi.mock('../src/server/settings', () => ({ getSetting: vi.fn() }));
vi.mock('../src/server/auth/customer-links', () => ({ manageLinkForBooking: vi.fn(), bookingPurposeLink: vi.fn() }));
vi.mock('../src/server/services/customer-self-service', () => ({ payLinkForExtraCharge: vi.fn(), payLinkForManualQuote: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));

import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from '../src/server/mail/errors';
import { processOutboxEventNow } from '../src/server/outbox/processor';

const now = new Date('2031-01-01T12:00:00.000Z');
const emailPayload = { template: 'booking-confirmed', to: ['customer@example.test'], data: { reference: 'SV-UNIT' } };

function claimedEvent(type = 'email.send', payload: unknown = emailPayload, attempts = 1): void {
  mocks.update.mockResolvedValue({ id: 'mail-event', attempts, type, payload });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  claimedEvent();
});
afterEach(() => vi.useRealTimers());

type LedgerRow = { id: string; outboxEventId: string | null; status: string; nextAttemptAt: Date | null; lastErrorCode: string | null };
function ledgerRow(status: string, outboxEventId: string | null = 'mail-event'): LedgerRow {
  const row: LedgerRow = { id: 'reply-delivery', outboxEventId, status, nextAttemptAt: null, lastErrorCode: null };
  mocks.ledgerUpdate.mockImplementation(({ where, data }: {
    where: { OR: ({ outboxEventId: string } | { id: string })[]; status: { in: string[] } };
    data: Pick<LedgerRow, 'status' | 'nextAttemptAt' | 'lastErrorCode'>;
  }) => {
    const matches = where.OR.some((identity) => 'id' in identity ? identity.id === row.id : identity.outboxEventId === row.outboxEventId)
      && where.status.in.includes(row.status);
    if (matches) Object.assign(row, data);
    return Promise.resolve({ count: matches ? 1 : 0 });
  });
  return row;
}

describe('outbox and delivery ledger share one failure decision', () => {
  it.each(['QUEUED', 'RETRY', 'DEFERRED'])('makes a %s ledger terminal when outbox retries are exhausted', async (status) => {
    const row = ledgerRow(status);
    claimedEvent('email.send', emailPayload, 6);
    mocks.email.mockRejectedValue(new MailTransientError('MAIL_STORAGE_UNAVAILABLE'));
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(row).toMatchObject({ status: 'FAILED', nextAttemptAt: null, lastErrorCode: 'MAIL_STORAGE_UNAVAILABLE' });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 'mail-event' }, data: {
      claimedAt: null, lastError: 'MAIL_STORAGE_UNAVAILABLE', status: 'FAILED',
    } });
  });
  it('makes a queued ledger terminal even if configuration failed before the delivery was loaded', async () => {
    const row = ledgerRow('QUEUED');
    mocks.email.mockRejectedValue(new MailPermanentError('MAIL_NOT_CONFIGURED'));
    await processOutboxEventNow('mail-event');
    expect(row.status).toBe('FAILED');
    expect(row.lastErrorCode).toBe('MAIL_NOT_CONFIGURED');
  });
  it('uses exactly the same next retry time in the ledger and outbox', async () => {
    const row = ledgerRow('QUEUED');
    mocks.email.mockRejectedValue(new Error('Database detail that must not become a public mail code'));
    await processOutboxEventNow('mail-event');
    expect(row).toMatchObject({ status: 'RETRY', nextAttemptAt: new Date(now.getTime() + 60_000), lastErrorCode: 'MAIL_OUTBOX_UNAVAILABLE' });
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 'mail-event' }, data: expect.objectContaining({ nextAttemptAt: row.nextAttemptAt, status: 'PENDING' }) as unknown });
  });
  it('reflects the provider quota retry time without inventing a send attempt', async () => {
    const row = ledgerRow('RETRY');
    const retryAt = new Date('2031-01-02T00:00:01Z');
    mocks.email.mockRejectedValue(new MailDeferredError(retryAt));
    await processOutboxEventNow('mail-event');
    expect(row).toMatchObject({ status: 'DEFERRED', nextAttemptAt: retryAt, lastErrorCode: 'MAIL_QUOTA_DEFERRED' });
    expect(mocks.ledgerUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DEFERRED', nextAttemptAt: retryAt, lastErrorCode: 'MAIL_QUOTA_DEFERRED' } }));
  });
  it.each(['SENT', 'UNCERTAIN', 'SENDING', 'FAILED'])('preserves a concurrently changed %s ledger while failing the old outbox claim', async (status) => {
    const row = ledgerRow(status);
    mocks.email.mockRejectedValue(new MailPermanentError('MAIL_NOT_CONFIGURED'));
    await processOutboxEventNow('mail-event');
    expect(row).toEqual({ id: 'reply-delivery', outboxEventId: 'mail-event', status, nextAttemptAt: null, lastErrorCode: null });
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 'mail-event' }, data: { claimedAt: null, lastError: 'MAIL_NOT_CONFIGURED', status: 'FAILED' } });
  });
  it('locates admin reply deliveries through their validated payload identity', async () => {
    const row = ledgerRow('QUEUED', null);
    claimedEvent('email.reply', { deliveryId: row.id }, 6);
    mocks.delivery.mockRejectedValue(new MailTransientError());
    await processOutboxEventNow('mail-event');
    expect(row.status).toBe('FAILED');
  });
  it('does not publish a failure decision when the ledger write cannot commit', async () => {
    mocks.email.mockRejectedValue(new MailPermanentError());
    mocks.ledgerUpdate.mockRejectedValue(new Error('Storage still unavailable'));
    await expect(processOutboxEventNow('mail-event')).rejects.toThrow('Storage still unavailable');
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('durable mail outbox failure policy', () => {
  it.each([
    { label: 'uncertain delivery', error: new MailReviewRequiredError() },
    { label: 'permanent rejection', error: new MailPermanentError() },
  ])('stops automatic retries after $label and records one deduplicated admin alert', async ({ error }) => {
    mocks.email.mockRejectedValue(error);
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.email).toHaveBeenCalledExactlyOnceWith(emailPayload, 'mail-event');
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' }, data: { claimedAt: null, lastError: error.message, status: 'FAILED' },
    });
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({
      where: { dedupeKey: 'system.alert:outbox-failed:mail-event' },
      update: {},
      create: {
        dedupeKey: 'system.alert:outbox-failed:mail-event',
        type: 'system.alert',
        payload: { issue: `Outbox event mail-event failed: ${error.message}` },
      },
    });
  });

  it('defers a quota-limited message until the provider retry time without consuming an attempt', async () => {
    const retryAt = new Date('2031-01-02T00:00:00.000Z');
    mocks.email.mockRejectedValue(new MailDeferredError(retryAt));
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' },
      data: { attempts: { decrement: 1 }, claimedAt: null, lastError: 'MAIL_QUOTA_DEFERRED', nextAttemptAt: retryAt, status: 'PENDING' },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([[1, 1], [2, 5], [3, 15], [4, 60], [5, 360]])('keeps transient attempt %i retryable after %i minutes', async (attempts, minutes) => {
    claimedEvent('email.send', emailPayload, attempts);
    mocks.email.mockRejectedValue(new MailTransientError());
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' },
      data: { claimedAt: null, lastError: 'MAIL_UNAVAILABLE', nextAttemptAt: new Date(now.getTime() + minutes * 60_000), status: 'PENDING' },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('stops transient delivery after the sixth attempt', async () => {
    claimedEvent('email.send', emailPayload, 6);
    mocks.email.mockRejectedValue(new MailTransientError());
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' }, data: { claimedAt: null, lastError: 'MAIL_UNAVAILABLE', status: 'FAILED' },
    });
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });

  it('does not create another system alert when the system-alert email itself permanently fails', async () => {
    claimedEvent('email.send', { ...emailPayload, template: 'admin-system-alert' });
    mocks.email.mockRejectedValue(new MailPermanentError());
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' }, data: { claimedAt: null, lastError: 'MAIL_REJECTED', status: 'FAILED' },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('never persists raw MIME or credentials from an unexpected provider/database error', async () => {
    claimedEvent('email.send', emailPayload, 6);
    mocks.email.mockRejectedValue(new Error('password=secret MIME: private customer message'));
    await processOutboxEventNow('mail-event');
    const persisted = JSON.stringify([mocks.update.mock.calls, mocks.upsert.mock.calls]);
    expect(persisted).toContain('MAIL_OUTBOX_UNAVAILABLE');
    expect(persisted).not.toContain('password=secret');
    expect(persisted).not.toContain('private customer message');
  });
});

describe('reply delivery uses the stored mail ledger', () => {
  it('passes only the validated delivery identity and completes the outbox event after delivery', async () => {
    claimedEvent('email.reply', { deliveryId: 'reply-delivery' });
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 1, failed: 0 });
    expect(mocks.delivery).toHaveBeenCalledExactlyOnceWith('reply-delivery');
    expect(mocks.email).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' }, data: { claimedAt: null, lastError: null, processedAt: now, status: 'DONE' },
    });
    expect(mocks.update.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.delivery.mock.invocationCallOrder[0] ?? 0);
  });

  it.each([{}, { deliveryId: '' }, { deliveryId: 'reply-delivery', to: 'unexpected@example.test' }])('rejects a malformed reply payload before any provider call: %j', async (payload) => {
    claimedEvent('email.reply', payload);
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('does not mark a deferred reply done', async () => {
    const retryAt = new Date('2031-01-01T13:00:00.000Z');
    claimedEvent('email.reply', { deliveryId: 'reply-delivery' });
    mocks.delivery.mockRejectedValue(new MailDeferredError(retryAt));
    expect(await processOutboxEventNow('mail-event')).toEqual({ done: 0, failed: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith({
      where: { id: 'mail-event' },
      data: { attempts: { decrement: 1 }, claimedAt: null, lastError: 'MAIL_QUOTA_DEFERRED', nextAttemptAt: retryAt, status: 'PENDING' },
    });
  });
});
