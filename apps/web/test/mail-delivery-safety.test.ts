import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SmtpModule from '../src/server/mail/smtp';
import type * as QuotaModule from '../src/server/mail/quota';

const mocks = vi.hoisted(() => ({
  find: vi.fn(), findStatus: vi.fn(), update: vi.fn(), save: vi.fn(), transaction: vi.fn(),
  attemptCreate: vi.fn(), attemptUpdate: vi.fn(), smtp: vi.fn(), compile: vi.fn(),
  append: vi.fn(), findSent: vi.fn(), reserve: vi.fn(), lease: vi.fn(), env: vi.fn(),
  raw: vi.fn(), retryEvent: vi.fn(), updateEvent: vi.fn(), audit: vi.fn(),
  readPage: vi.fn(), persistPage: vi.fn(),
}));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: {
  mailDelivery: { findFirst: mocks.find, findUnique: mocks.findStatus, update: mocks.update, upsert: mocks.save },
  mailDeliveryAttempt: { create: mocks.attemptCreate, update: mocks.attemptUpdate }, $transaction: mocks.transaction,
} }));
vi.mock('../src/server/env', () => ({ serverEnv: mocks.env }));
vi.mock('../src/server/mail/config', () => ({ mailConfig: () => ({ mailbox: 'support@example.test' }) }));
vi.mock('../src/server/mail/lease', () => ({ withMailLease: mocks.lease }));
vi.mock('../src/server/mail/imap', () => ({ appendSentMessage: mocks.append, findSentMessage: mocks.findSent, readImapPage: mocks.readPage }));
vi.mock('../src/server/mail/repository', () => ({ persistPage: mocks.persistPage }));
vi.mock('../src/server/mail/smtp', async (importOriginal) => ({
  ...await importOriginal<typeof SmtpModule>(), sendSmtp: mocks.smtp, compileMail: mocks.compile,
}));
vi.mock('../src/server/mail/quota', async (importOriginal) => ({
  ...await importOriginal<typeof QuotaModule>(), reserveQuota: mocks.reserve,
}));

import { deliveryMessageId, prepareDelivery, processMailDelivery, retryMailDelivery, saveDelivery } from '../src/server/mail/delivery';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from '../src/server/mail/errors';

const now = new Date('2031-01-01T12:00:00.000Z');
function freshDelivery() {
  return { id: 'delivery-one', key: 'outbox:event-one', mailbox: 'support@example.test', status: 'QUEUED', attempts: 0,
    messageId: '<stable@example.test>', rawMime: new Uint8Array([1, 2, 3]), envelope: { to: ['customer@example.test'], cc: [], bcc: [] },
    sentCopySaved: false, sentAt: null as Date | null, lastErrorCode: null as string | null, nextAttemptAt: null as Date | null };
}
let delivery = freshDelivery();
type DeliveryPatch = Partial<Omit<ReturnType<typeof freshDelivery>, 'attempts'>> & { attempts?: number | { increment: number } };
const tx = {
  $executeRaw: mocks.raw,
  mailDelivery: { findFirst: mocks.find, update: mocks.update, upsert: mocks.save },
  mailDeliveryAttempt: { create: mocks.attemptCreate, update: mocks.attemptUpdate },
  outboxEvent: { upsert: mocks.retryEvent, update: mocks.updateEvent },
  auditLog: { create: mocks.audit },
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let finish: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, resolve(value) { if (!finish) throw new Error('Deferred operation not ready.'); finish(value); } };
}

function useExclusiveLeases(): void {
  const held = new Set<string>();
  mocks.lease.mockImplementation(async (key: string, run: () => Promise<unknown>) => {
    if (held.has(key)) throw new MailDeferredError(new Date(now.getTime() + 15_000), 'MAIL_BUSY');
    held.add(key);
    try { return await run(); } finally { held.delete(key); }
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  delivery = freshDelivery();
  mocks.env.mockReturnValue({ LARK_MAIL_SEND_ENABLED: 'true' });
  mocks.find.mockImplementation(() => Promise.resolve({ ...delivery }));
  mocks.findStatus.mockImplementation(() => Promise.resolve({ status: delivery.status }));
  mocks.update.mockImplementation(({ data }: { data: DeliveryPatch }) => {
    delivery = { ...delivery, ...data, attempts: typeof data.attempts === 'number' ? data.attempts
      : data.attempts ? delivery.attempts + data.attempts.increment : delivery.attempts };
    return Promise.resolve({ ...delivery });
  });
  mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  mocks.lease.mockImplementation((_key: string, run: () => Promise<unknown>) => run());
  mocks.attemptCreate.mockResolvedValue({ id: 'attempt-one' });
  mocks.smtp.mockResolvedValue(250);
  mocks.findSent.mockResolvedValue(false);
  mocks.compile.mockResolvedValue(Buffer.from('compiled MIME'));
  mocks.retryEvent.mockResolvedValue({ id: 'retry-event', status: 'PENDING' });
  mocks.readPage.mockResolvedValue({ messages: [] });
});
afterEach(() => vi.useRealTimers());

describe('mail delivery acceptance and restart safety', () => {
  it('records acceptance before copying Sent and never submits SMTP twice for a completed delivery', async () => {
    await processMailDelivery('delivery-one');
    await processMailDelivery('delivery-one');
    expect(mocks.smtp).toHaveBeenCalledExactlyOnceWith(delivery.rawMime, delivery.envelope);
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(tx, 'support@example.test', ['customer@example.test']);
    expect(mocks.attemptUpdate).toHaveBeenCalledWith({ where: { id: 'attempt-one' }, data: { outcome: 'ACCEPTED', providerCode: 250, finishedAt: now } });
    expect(mocks.attemptUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.append.mock.invocationCallOrder[0] ?? 0);
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(true);
    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.readPage).toHaveBeenCalledExactlyOnceWith('sent', { limit: 50 });
    expect(mocks.persistPage).toHaveBeenCalledExactlyOnceWith('support@example.test', 'sent', { messages: [] }, 'latest');
  });

  it('retries only the Sent copy after SMTP was accepted and IMAP append failed', async () => {
    mocks.append.mockRejectedValueOnce(new MailTransientError('MAIL_IMAP_UNAVAILABLE'));
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'MAIL_SENT_COPY_PENDING' });
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(false);
    await processMailDelivery('delivery-one');
    expect(mocks.smtp).toHaveBeenCalledOnce(); expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(delivery.sentCopySaved).toBe(true);
  });

  it('retries only idempotent Sent maintenance after saving the conversation cache fails', async () => {
    mocks.persistPage.mockRejectedValueOnce(new Error('Conversation cache unavailable'));
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'MAIL_SENT_COPY_PENDING' });
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(false);
    expect(mocks.append).toHaveBeenCalledOnce();
    await processMailDelivery('delivery-one');
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(true);
    expect(mocks.smtp).toHaveBeenCalledOnce(); expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append.mock.calls[0]).toEqual(mocks.append.mock.calls[1]);
    expect(mocks.readPage).toHaveBeenCalledTimes(2); expect(mocks.persistPage).toHaveBeenCalledTimes(2);
  });

  it.each(['SENDING', 'UNCERTAIN'])('reconciles a %s record from a matching Sent message without resending', async (status) => {
    delivery.status = status; mocks.findSent.mockResolvedValue(true);
    await processMailDelivery('delivery-one');
    expect(mocks.findSent).toHaveBeenCalledExactlyOnceWith(delivery.messageId);
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(true);
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each(['SENDING', 'UNCERTAIN'])('holds a %s record for manual review when acceptance cannot be proven', async (status) => {
    delivery.status = status;
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailReviewRequiredError);
    expect(delivery.status).toBe('UNCERTAIN');
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled();
  });

  it('does not interpret an unavailable Sent folder as proof that sending failed', async () => {
    delivery.status = 'SENDING'; mocks.findSent.mockRejectedValue(new MailTransientError());
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailReviewRequiredError);
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(delivery.status).toBe('UNCERTAIN');
  });

  it('records an uncertain SMTP outcome and does not resend it on the next run', async () => {
    mocks.smtp.mockRejectedValue(new MailReviewRequiredError('MAIL_SEND_TIMEOUT_UNCERTAIN'));
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailReviewRequiredError);
    expect(delivery.status).toBe('UNCERTAIN');
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailReviewRequiredError);
    expect(mocks.smtp).toHaveBeenCalledOnce();
  });

  it('treats an unexpected transport failure as uncertain instead of scheduling a blind resend', async () => {
    mocks.smtp.mockRejectedValue(new Error('Unknown transport outcome'));
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailReviewRequiredError);
    expect(delivery.status).toBe('UNCERTAIN');
  });
});

describe('mail quota and retry outcomes', () => {
  it('retries a storage failure before SMTP without misclassifying it as uncertain delivery', async () => {
    mocks.reserve.mockRejectedValueOnce(new Error('Quota storage unavailable'));
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'MAIL_STORAGE_UNAVAILABLE' });
    expect(delivery.status).toBe('RETRY'); expect(delivery.attempts).toBe(0);
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.attemptCreate).not.toHaveBeenCalled();
    await processMailDelivery('delivery-one');
    expect(delivery.status).toBe('SENT'); expect(mocks.smtp).toHaveBeenCalledOnce();
  });

  it('defers before SMTP and attempt creation when quota reservation is unavailable', async () => {
    const retryAt = new Date('2031-01-02T00:00:01.000Z');
    const error = new MailDeferredError(retryAt);
    mocks.reserve.mockRejectedValue(error);
    await expect(processMailDelivery('delivery-one')).rejects.toBe(error);
    expect(delivery.status).toBe('DEFERRED'); expect(delivery.nextAttemptAt).toEqual(retryAt); expect(delivery.attempts).toBe(0);
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it('permits a known transient rejection to retry with the identical stored MIME', async () => {
    mocks.smtp.mockRejectedValueOnce(new MailTransientError('SMTP_451'));
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'SMTP_451' });
    expect(delivery.status).toBe('RETRY'); expect(delivery.attempts).toBe(1);
    await processMailDelivery('delivery-one');
    expect(delivery.status).toBe('SENT'); expect(delivery.attempts).toBe(2);
    expect(mocks.smtp.mock.calls[0]).toEqual(mocks.smtp.mock.calls[1]);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
  });

  it('makes a permanent SMTP rejection terminal before another process can resend', async () => {
    mocks.smtp.mockRejectedValue(new MailPermanentError('SMTP_550'));
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'SMTP_550' });
    expect(delivery.status).toBe('FAILED');
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailPermanentError);
    expect(mocks.smtp).toHaveBeenCalledOnce();
  });

  it('makes the sixth known transient rejection terminal', async () => {
    delivery.attempts = 5; mocks.smtp.mockRejectedValue(new MailTransientError('SMTP_451'));
    await expect(processMailDelivery('delivery-one')).rejects.toBeInstanceOf(MailTransientError);
    expect(delivery.status).toBe('FAILED'); expect(delivery.attempts).toBe(6);
  });

  it('fails closed when sending has not been enabled', async () => {
    mocks.env.mockReturnValue({ LARK_MAIL_SEND_ENABLED: 'false' });
    await expect(processMailDelivery('delivery-one')).rejects.toMatchObject({ code: 'MAIL_SENDING_DISABLED' });
    expect(delivery.status).toBe('FAILED'); expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('refuses an unknown delivery', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(processMailDelivery('missing')).rejects.toMatchObject({ code: 'MAIL_DELIVERY_NOT_FOUND' });
    expect(mocks.smtp).not.toHaveBeenCalled();
  });
});

describe('admin retry and active delivery share the same mailbox lease', () => {
  it.each(['accepted', 'uncertain'] as const)('cannot resurrect a delivery while its provider outcome becomes %s', async (outcome) => {
    useExclusiveLeases();
    delivery.status = 'RETRY';
    const reserving = deferred<undefined>();
    const allowReservation = deferred<undefined>();
    const submitting = deferred<undefined>();
    const finishSubmission = deferred<undefined>();
    mocks.reserve.mockImplementation(() => { reserving.resolve(undefined); return allowReservation.promise; });
    mocks.smtp.mockImplementation(async () => {
      submitting.resolve(undefined);
      await finishSubmission.promise;
      if (outcome === 'uncertain') throw new MailReviewRequiredError();
      return 250;
    });

    const processing = processMailDelivery('delivery-one').catch((error: unknown) => error);
    await reserving.promise;
    // The sender owns the mailbox lease, but has not changed RETRY to SENDING.
    // This is the old race window where an admin could read a stale RETRY row.
    expect(delivery.status).toBe('RETRY');
    await expect(retryMailDelivery('delivery-one', 'admin-one', false)).rejects.toMatchObject({ code: 'MAIL_BUSY' });
    expect(mocks.find).toHaveBeenCalledOnce();
    expect(mocks.retryEvent).not.toHaveBeenCalled();

    allowReservation.resolve(undefined);
    await submitting.promise;
    expect(delivery.status).toBe('SENDING');
    await expect(retryMailDelivery('delivery-one', 'admin-one', false)).rejects.toMatchObject({ code: 'MAIL_BUSY' });
    finishSubmission.resolve(undefined);
    const result = await processing;
    if (outcome === 'uncertain') expect(result).toBeInstanceOf(MailReviewRequiredError);
    else expect(result).toBeUndefined();

    expect(delivery.status).toBe(outcome === 'accepted' ? 'SENT' : 'UNCERTAIN');
    // Once the lease is released, the retry reads the actual completed outcome.
    await expect(retryMailDelivery('delivery-one', 'admin-one', false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.retryEvent).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.smtp).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls.some((args: unknown[]) => {
      const value = args[0];
      return Boolean(value && typeof value === 'object' && 'data' in value && value.data && typeof value.data === 'object'
        && 'status' in value.data && value.data.status === 'QUEUED');
    })).toBe(false);
  });

  it('requires explicit duplicate-risk acknowledgement before requeuing an uncertain delivery', async () => {
    useExclusiveLeases(); delivery.status = 'UNCERTAIN';
    await expect(retryMailDelivery('delivery-one', 'admin-one', false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(delivery.status).toBe('UNCERTAIN');
    expect(await retryMailDelivery('delivery-one', 'admin-one', true)).toEqual({ deliveryId: 'delivery-one', status: 'QUEUED', outboxEventId: 'retry-event' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ after: { acknowledgedDuplicateRisk: true } }) as unknown }));
    expect(mocks.smtp).not.toHaveBeenCalled();
  });

  it('keeps a previously accepted delivery SENT when an admin requests another Sent-copy attempt', async () => {
    useExclusiveLeases(); delivery.status = 'SENT'; delivery.sentCopySaved = false;
    expect(await retryMailDelivery('delivery-one', 'admin-one', false)).toEqual({ deliveryId: 'delivery-one', status: 'SENT', outboxEventId: 'retry-event' });
    await processMailDelivery('delivery-one');
    expect(delivery.status).toBe('SENT'); expect(delivery.sentCopySaved).toBe(true);
    expect(mocks.smtp).not.toHaveBeenCalled(); expect(mocks.append).toHaveBeenCalledOnce();
  });
});

describe('immutable prepared messages', () => {
  it('derives a stable non-identifying Message-ID and stores normalized envelope recipients', async () => {
    const key = 'outbox:event-one';
    const mail = { to: [' CUSTOMER@EXAMPLE.TEST '], subject: 'Confirmed', text: 'Body' };
    const prepared = await prepareDelivery(key, mail, 'request-hash');
    expect(prepared.messageId).toBe(deliveryMessageId(key, 'support@example.test'));
    expect(prepared.messageId).toMatch(/^<sv\.[a-f0-9]{64}@example\.test>$/u);
    expect(prepared.envelope).toEqual({ to: ['customer@example.test'], cc: [], bcc: [], requestHash: 'request-hash' });
    expect(mocks.compile).toHaveBeenCalledExactlyOnceWith(mail, prepared.messageId, now);
  });

  it('does not overwrite an existing unique-key delivery when saving a competing prepared message', async () => {
    const prepared = await prepareDelivery('outbox:event-one', { to: ['customer@example.test'], subject: 'Confirmed', text: 'Body' });
    // The transaction client is intentionally restricted to the member used by saveDelivery.
    const { prisma } = await import('@sv/db');
    await prisma.$transaction((client) => saveDelivery(client, prepared, 'event-one'));
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ where: { key: prepared.key }, update: {}, create: { ...prepared, outboxEventId: 'event-one' } });
  });
});
