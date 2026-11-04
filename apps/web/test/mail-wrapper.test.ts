import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), render: vi.fn(), prepare: vi.fn(), save: vi.fn(), process: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { mailDelivery: { findUnique: mocks.find }, $transaction: mocks.transaction } }));
vi.mock('@sv/emails', () => ({ renderEmailTemplate: mocks.render }));
vi.mock('../src/server/mail/delivery', () => ({ prepareDelivery: mocks.prepare, saveDelivery: mocks.save, processMailDelivery: mocks.process }));
vi.mock('../src/server/mail/config', () => ({ mailConfig: () => ({ mailbox: 'support@example.test' }) }));
import { sendTransactionalEmail } from '../src/server/integrations/mail';
import { MailPermanentError, MailReviewRequiredError } from '../src/server/mail/errors';

const tx = { transactionIdentity: 'mail-write' };
const prepared = { key: 'outbox:event-one', messageId: '<stable@example.test>', rawMime: new Uint8Array([1, 2, 3]) };
const payload = { template: 'booking-confirmed' as const, to: [' CUSTOMER@example.test ', 'customer@example.test'], data: { reference: 'SV-UNIT' } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(null);
  mocks.render.mockResolvedValue({ subject: 'Booking confirmed', html: '<p>Confirmed</p>', text: 'Confirmed' });
  mocks.prepare.mockResolvedValue(prepared);
  mocks.save.mockResolvedValue({ id: 'delivery-one' });
  mocks.transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
});

describe('transactional email uses the durable mail ledger', () => {
  it('renders once, normalizes recipients, saves in a transaction, then processes the saved delivery', async () => {
    await sendTransactionalEmail(payload, 'event-one');
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith({ where: { key: 'outbox:event-one' }, select: { id: true } });
    expect(mocks.render).toHaveBeenCalledExactlyOnceWith(payload.template, payload.data);
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith('outbox:event-one', {
      to: ['customer@example.test'], subject: 'Booking confirmed', html: '<p>Confirmed</p>', text: 'Confirmed', replyTo: 'support@example.test',
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(tx, prepared, 'event-one');
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith('delivery-one');
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.save.mock.invocationCallOrder[0] ?? 0);
  });

  it('reuses a persisted delivery after a restart without re-rendering or changing its stored MIME', async () => {
    mocks.find.mockResolvedValue({ id: 'existing-delivery' });
    await sendTransactionalEmail({ ...payload, data: { reference: 'CHANGED-AFTER-SEND' } }, 'event-one');
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith('existing-delivery');
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('processes the delivery returned by the unique-key upsert when another worker created it first', async () => {
    mocks.save.mockResolvedValue({ id: 'winning-delivery' });
    await sendTransactionalEmail({ ...payload, to: 'customer@example.test' }, 'event-one');
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith('winning-delivery');
  });

  it('does not send when storing the delivery fails', async () => {
    mocks.save.mockRejectedValue(new Error('Database unavailable'));
    await expect(sendTransactionalEmail(payload, 'event-one')).rejects.toThrow('Database unavailable');
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it.each([{ to: 'invalid-address' }, { to: '' }, { to: [] }, { to: [''] }])('rejects invalid or missing recipients before saving or sending: $to', async ({ to }) => {
    await expect(sendTransactionalEmail({ ...payload, to }, 'event-one')).rejects.toBeInstanceOf(MailPermanentError);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('propagates an uncertain result so the outbox can stop automatic retries', async () => {
    mocks.find.mockResolvedValue({ id: 'existing-delivery' });
    const uncertain = new MailReviewRequiredError();
    mocks.process.mockRejectedValue(uncertain);
    await expect(sendTransactionalEmail(payload, 'event-one')).rejects.toBe(uncertain);
  });
});
