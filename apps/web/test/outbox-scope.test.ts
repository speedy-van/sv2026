import { Prisma } from '../../../packages/db/src/generated/prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  query: vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<{
    id: string; type: string; payload: unknown; attempts: number;
  }[]>>(),
  update: vi.fn(),
  payment: vi.fn(),
  email: vi.fn(),
}));
vi.mock('@sv/db', async () => {
  const { Prisma: sql } = await import('../../../packages/db/src/generated/prisma/client');
  return {
    Prisma: sql,
    enqueueOutbox: vi.fn(),
    prisma: { $transaction: mocks.transaction, outboxEvent: { update: mocks.update } },
  };
});
afterEach(() => vi.unstubAllEnvs());
vi.mock('../src/server/integrations/resend', () => ({ sendTransactionalEmail: mocks.email }));
vi.mock('../src/server/integrations/expo-push', () => ({ sendPushOutbox: vi.fn() }));
vi.mock('../src/server/settings', () => ({ getSetting: vi.fn() }));
vi.mock('../src/server/auth/customer-links', () => ({ manageLinkForBooking: vi.fn(), bookingPurposeLink: vi.fn() }));
vi.mock('../src/server/services/customer-self-service', () => ({ payLinkForExtraCharge: vi.fn(), payLinkForManualQuote: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ runRefundOutbox: vi.fn() }));

import { processOutboxBatch } from '../src/server/outbox/processor';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('OUTBOX_PROCESS_FROM', '');
  mocks.query.mockResolvedValue([]);
  mocks.transaction.mockImplementation((operation: (tx: {
    $queryRaw: typeof mocks.query; payment: { findUnique: typeof mocks.payment };
  }) => Promise<unknown>) =>
    operation({ $queryRaw: mocks.query, payment: { findUnique: mocks.payment } }),
  );
});

function claimedSql(): Prisma.Sql {
  const call = mocks.query.mock.calls[0];
  if (!call) throw new Error('Expected an atomic outbox claim.');
  const [strings, ...values] = call;
  return Prisma.sql(strings, ...values);
}

describe('atomic scoped outbox claims', () => {
  it('restricts eligible work to a literal event identity/child prefix, due pending state and allowed channel types', async () => {
    await processOutboxBatch(1, ['booking.confirmed', 'notification.create', 'push.send', 'email.send'], {
      rootEventId: 'event_%_unit',
    });
    const query = claimedSql();
    expect(query.sql).toContain('"status" = \'PENDING\' AND "nextAttemptAt" <= now()');
    expect(query.sql).toContain('AND ("id" = ? OR starts_with("dedupeKey", ?))');
    expect(query.sql).toContain('AND "type" IN (?,?,?,?)');
    expect(query.values).toEqual([
      'booking.confirmed', 'notification.create', 'push.send', 'email.send',
      'event_%_unit', 'event_%_unit:', 1,
    ]);
    expect(query.sql).not.toContain('LIKE');
    expect(query.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.sql).toContain('SET "status" = \'PROCESSING\', "attempts" = "attempts" + 1');
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('prioritises the confirmation expansion and fast notification/push channels ahead of email', async () => {
    await processOutboxBatch(1, ['booking.confirmed', 'notification.create', 'push.send', 'email.send'], {
      rootEventId: 'event-unit',
    });
    expect(claimedSql().sql).toContain(
      'ORDER BY CASE "type" WHEN \'notification.create\' THEN 1 WHEN \'push.send\' THEN 2 WHEN \'email.send\' THEN 3 ELSE 0 END, "createdAt" ASC',
    );
  });

  it('can deliver only the explicitly scoped manage-link email and marks its own event done', async () => {
    const payload = { template: 'manage-link', to: ['customer@example.test'], data: { reference: 'SV-UNIT01' } };
    mocks.query.mockResolvedValue([{ id: 'email-unit', type: 'email.send', payload, attempts: 1 }]);
    expect(await processOutboxBatch(1, ['email.send'], { rootEventId: 'email-unit' })).toEqual({ done: 1, failed: 0 });
    expect(claimedSql().values).toEqual(['email.send', 'email-unit', 'email-unit:', 1]);
    expect(mocks.email).toHaveBeenCalledExactlyOnceWith(payload, 'email-unit');
    const processedAt: unknown = expect.any(Date);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'email-unit' },
      data: { lastError: null, processedAt, status: 'DONE' },
    });
  });

  it('leaves a scoped provider failure pending with its durable backoff rather than delivering unrelated jobs', async () => {
    mocks.query.mockResolvedValue([{ id: 'email-unit', type: 'email.send', payload: {}, attempts: 1 }]);
    mocks.email.mockRejectedValue(new Error('Unit provider unavailable.'));
    expect(await processOutboxBatch(1, ['email.send'], { rootEventId: 'email-unit' })).toEqual({ done: 0, failed: 1 });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const nextAttemptAt: unknown = expect.any(Date);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'email-unit' },
      data: { lastError: 'Unit provider unavailable.', nextAttemptAt, status: 'PENDING' },
    });
  });

  it('refuses an empty scope before accessing the database', async () => {
    await expect(processOutboxBatch(1, ['email.send'], { rootEventId: '' })).rejects.toThrow('requires an event id');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([undefined, { rootEventId: 'new-event-unit' }])('excludes pre-activation events from every production claim: %j', async (scope) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OUTBOX_PROCESS_FROM', '2026-10-15T22:00:00.000Z');
    await processOutboxBatch(1, ['email.send'], scope);
    const query = claimedSql();
    expect(query.sql).toContain('AND "createdAt" >= ?');
    expect(query.values[0]).toEqual(new Date('2026-10-15T22:00:00.000Z'));
  });

  it('fails closed before claiming production work when the activation cutoff is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('OUTBOX_PROCESS_FROM', '');
    await expect(processOutboxBatch(1)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid activation timestamp before claiming work', async () => {
    vi.stubEnv('OUTBOX_PROCESS_FROM', 'yesterday');
    await expect(processOutboxBatch(1)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([0, 50])('does not announce a completed late-payment refund when only %i of100pence has succeeded', async (amountPence) => {
    mocks.query.mockResolvedValue([{ id: 'late-unit', type: 'payment.after_expiry_refunded', payload: { paymentId: 'payment-unit' }, attempts: 1 }]);
    mocks.payment.mockResolvedValue({ amountPence: 100, refunds: [{ amountPence }] });
    expect(await processOutboxBatch(1, ['payment.after_expiry_refunded'], { rootEventId: 'late-unit' })).toEqual({ done: 0, failed: 1 });
    expect(mocks.email).not.toHaveBeenCalled();
    const nextAttemptAt: unknown = expect.any(Date);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'late-unit' },
      data: { lastError: 'The late-payment refund has not succeeded yet.', nextAttemptAt, status: 'PENDING' },
    });
  });
});
