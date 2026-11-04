import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@sv/contracts';
import type { Prisma } from '@sv/db';
import type * as Repository from '../src/server/mail/repository';

const mocks = vi.hoisted(() => ({ folder: vi.fn(), message: vi.fn(), messages: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  delivery: vi.fn(), outbox: vi.fn(), outboxUpdate: vi.fn(), audit: vi.fn(), raw: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  source: vi.fn(), seen: vi.fn(), download: vi.fn(), sync: vi.fn(), requireMessage: vi.fn(), prepare: vi.fn(), save: vi.fn(), env: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), empty: '' }, prisma: {
  mailFolder: { findUnique: mocks.folder }, mailMessage: { findFirst: mocks.message, findMany: mocks.messages, update: mocks.update, updateMany: mocks.updateMany },
  mailDelivery: { findUnique: mocks.delivery }, outboxEvent: { upsert: mocks.outbox, update: mocks.outboxUpdate }, auditLog: { create: mocks.audit },
  $queryRaw: mocks.raw, $executeRaw: mocks.execute, $transaction: mocks.transaction,
} }));
vi.mock('../src/server/mail/config', () => ({ mailConfig: () => ({ mailbox: 'support@example.test' }), mailConfigured: () => true }));
vi.mock('../src/server/mail/lease', () => ({ withMailLease: (_key: string, task: () => Promise<unknown>) => task() }));
vi.mock('../src/server/mail/imap', () => ({ fetchImapMessage: mocks.source, setImapSeen: mocks.seen, downloadImapAttachment: mocks.download }));
vi.mock('../src/server/mail/delivery', () => ({ prepareDelivery: mocks.prepare, saveDelivery: mocks.save, retryMailDelivery: vi.fn() }));
vi.mock('../src/server/mail/repository', async (original) => ({ ...await original<typeof Repository>(), requireMailMessage: mocks.requireMessage, syncMailFolder: mocks.sync }));
vi.mock('../src/server/env', () => ({ serverEnv: mocks.env }));
import { enforceMailRateLimit, mailAttachment, markMailRead, queueMailReply, readMailThread, replyRecipients } from '../src/server/mail/service';

const at = new Date('2031-01-01T12:00:00.000Z');
const headers = { from: [{ address: 'customer@example.org', name: 'Customer' }], to: [{ address: 'support@example.test', name: '' }], cc: [{ address: 'partner@example.org', name: '' }],
  replyTo: [{ address: 'billing@example.org', name: '' }], subject: 'Booking question', messageId: '<customer@example.org>', inReplyTo: '<parent@example.org>', references: ['<root@example.org>'], dateISO: at.toISOString() };
const source = { ...headers, bodyText: 'Hello', sanitizedHtml: '<p>Hello</p>', bodyTruncated: false, attachments: [], seen: false, uid: 7, uidValidity: '12', size: 100 };
type Cached = Prisma.MailMessageGetPayload<object>;
const row: Cached = { id: 'message-one', mailbox: 'support@example.test', folder: 'inbox', uidValidity: '12', uid: 7n, threadId: 'thread-one', messageId: headers.messageId,
  inReplyTo: headers.inReplyTo, references: headers.references, fromAddresses: headers.from, toAddresses: headers.to, ccAddresses: headers.cc,
  subject: headers.subject, sentAt: at, createdAt: at, seen: false, size: 100, attachmentCount: 0, snippet: '' };
const input = { clientMessageId: 'b96e426b-3afc-40b9-b091-1360723714f1', mode: 'reply-all' as const, text: 'Thank you' };
const tx = { outboxEvent: { upsert: mocks.outbox, update: mocks.outboxUpdate }, auditLog: { create: mocks.audit }, mailMessage: { updateMany: mocks.updateMany }, $executeRaw: mocks.execute };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ LARK_MAIL_SEND_ENABLED: 'true' }); mocks.source.mockResolvedValue(source);
  mocks.requireMessage.mockResolvedValue(row); mocks.folder.mockResolvedValue({ lastSyncAt: new Date() });
  mocks.transaction.mockImplementation((task: (client: typeof tx) => Promise<unknown>) => task(tx));
  mocks.delivery.mockResolvedValue(null); mocks.prepare.mockImplementation((_key: string, mail: unknown, requestHash: string) => Promise.resolve({ mail, envelope: { to: ['billing@example.org'], requestHash } }));
  mocks.outbox.mockResolvedValue({ id: 'event-one' });
  mocks.save.mockImplementation((_tx: unknown, prepared: { envelope: unknown }) => Promise.resolve({ id: 'delivery-one', status: 'QUEUED', envelope: prepared.envelope }));
  mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.raw.mockResolvedValue([row]);
});

describe('admin mailbox service boundaries', () => {
  it('honours Reply-To, keeps reply-all CC, excludes the mailbox and deduplicates addresses', () => {
    expect(replyRecipients({ ...headers, to: [...headers.to, ...headers.replyTo, ...headers.cc] }, 'reply-all', 'support@example.test')).toEqual({ to: ['billing@example.org'], cc: ['partner@example.org'] });
    expect(replyRecipients(headers, 'reply', 'support@example.test')).toEqual({ to: ['billing@example.org'], cc: [] });
  });
  it('queues a threaded reply with stable client identity and provider headers inside one transaction', async () => {
    const result = await queueMailReply(row.id, input, 'admin-one');
    expect(result).toEqual({ deliveryId: 'delivery-one', status: 'QUEUED', outboxEventId: 'event-one' });
    expect(mocks.prepare).toHaveBeenCalledWith(`reply:admin-one:${input.clientMessageId}`, expect.objectContaining({ to: ['billing@example.org'], cc: ['partner@example.org'],
      subject: 'Re: Booking question', inReplyTo: '<customer@example.org>', references: ['<root@example.org>', '<parent@example.org>', '<customer@example.org>'] }), expect.any(String));
    expect(mocks.save).toHaveBeenCalledWith(tx, expect.any(Object), 'event-one');
    expect(mocks.outboxUpdate).toHaveBeenCalledWith({ where: { id: 'event-one' }, data: { payload: { deliveryId: 'delivery-one' } } });
  });
  it('returns the original queued reply after a lost HTTP response, without re-reading or re-queuing', async () => {
    await queueMailReply(row.id, input, 'admin-one');
    const prepared = mocks.save.mock.calls[0]?.[1] as { envelope: unknown };
    mocks.delivery.mockResolvedValue({ id: 'delivery-one', status: 'SENT', outboxEventId: 'event-one', envelope: prepared.envelope });
    expect(await queueMailReply(row.id, input, 'admin-one')).toMatchObject({ status: 'SENT' });
    expect(mocks.source).toHaveBeenCalledOnce(); expect(mocks.outbox).toHaveBeenCalledOnce();
    await expect(queueMailReply(row.id, { ...input, text: 'Changed content' }, 'admin-one')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rechecks the request hash under the transaction when two different requests share an idempotency key', async () => {
    mocks.save.mockResolvedValue({ id: 'other', status: 'QUEUED', envelope: { to: ['x@example.org'], requestHash: 'different' } });
    await expect(queueMailReply(row.id, input, 'admin-one')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.outboxUpdate).not.toHaveBeenCalled();
  });
  it('does not queue with sending disabled or when the original has no usable Message-ID', async () => {
    mocks.env.mockReturnValue({ LARK_MAIL_SEND_ENABLED: 'false' });
    await expect(queueMailReply(row.id, input, 'admin-one')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    mocks.env.mockReturnValue({ LARK_MAIL_SEND_ENABLED: 'true' }); mocks.source.mockResolvedValue({ ...source, messageId: null });
    await expect(queueMailReply(row.id, input, 'admin-one')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('adjusts unread count only for the first successful state transition', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await markMailRead(row.id, true); await markMailRead(row.id, true);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: row.id, seen: false }, data: { seen: true } });
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it('does not change local unread state if the provider rejects the flag update', async () => {
    mocks.seen.mockRejectedValue(new AppError('CONFLICT', 'Mailbox changed'));
    await expect(markMailRead(row.id, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('uses the stored UID and validity for attachment access and refuses missing scoped messages', async () => {
    await mailAttachment(row.id, 'attachment-one');
    expect(mocks.download).toHaveBeenCalledWith('inbox', 7, '12', 'attachment-one');
    mocks.requireMessage.mockRejectedValue(new AppError('NOT_FOUND', 'Message not found'));
    await expect(mailAttachment('other-user-message', 'attachment-one')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.download).toHaveBeenCalledOnce();
  });
  it('refreshes stale folders while a thread remains open and exposes truncated content', async () => {
    mocks.folder.mockResolvedValue({ lastSyncAt: new Date(0) }); mocks.source.mockResolvedValue({ ...source, bodyTruncated: true });
    const result = await readMailThread('thread-one', { limit: 20 });
    expect(mocks.sync).toHaveBeenCalledWith('inbox'); expect(mocks.sync).toHaveBeenCalledWith('sent');
    expect(result.messages[0]).toMatchObject({ bodyTruncated: true, replyTo: headers.replyTo });
  });
  it('paginates before serialized Unicode/control characters can exceed the function response limit', async () => {
    mocks.raw.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ ...row, id: `message-${String(index)}` })));
    mocks.source.mockResolvedValue({ ...source, bodyText: '\0'.repeat(200_000), sanitizedHtml: '界'.repeat(200_000) });
    const result = await readMailThread('thread-one', { limit: 20 });
    expect(result.messages).toHaveLength(1); expect(result.nextCursor).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(3 * 1024 * 1024);
  });
  it('enforces the database-backed per-user write limit with a bounded Retry-After', async () => {
    mocks.raw.mockResolvedValue([{ count: 21 }]);
    await expect(enforceMailRateLimit('admin-one', true, at)).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfter: 60 } });
    mocks.raw.mockResolvedValue([{ count: 1 }]); await expect(enforceMailRateLimit('admin-two', true, at)).resolves.toBeUndefined();
  });
});
