import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@sv/db';
import type * as Smtp from '../src/server/mail/smtp';
import type * as Quota from '../src/server/mail/quota';
const fixtures = vi.hoisted(() => ({ send: vi.fn(), found: vi.fn(), quotaLimit: 20 }));
const mailbox = 'support@mail-integration.invalid';
const day = new Date('2031-11-04T12:00:00.000Z');
vi.mock('../src/server/mail/config', () => ({ mailConfig: () => ({ mailbox: 'support@mail-integration.invalid', password: 'test-only-password', enabled: true }) }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ LARK_MAIL_SEND_ENABLED: 'true', LARK_MAIL_DAILY_MESSAGES: fixtures.quotaLimit,
  LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: 10, LARK_MAIL_ORG_DAILY_MESSAGES: 30, LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: 30, LARK_MAIL_MIN_SEND_INTERVAL_SECONDS: 2 }) }));
vi.mock('../src/server/mail/smtp', async (original) => ({ ...await original<typeof Smtp>(), sendSmtp: fixtures.send }));
vi.mock('../src/server/mail/quota', async (original) => {
  const actual = await original<typeof Quota>();
  return { ...actual, reserveQuota: (tx: Parameters<typeof actual.reserveQuota>[0], address: string, recipients: string[]) => actual.reserveQuota(tx, address, recipients, new Date('2031-11-04T12:00:00.000Z')) };
});
vi.mock('../src/server/mail/imap', () => ({ appendSentMessage: vi.fn(), findSentMessage: fixtures.found,
  fetchImapMessage: () => Promise.resolve({ from: [], to: [], cc: [], replyTo: [], subject: 'Duplicate', messageId: '<duplicate@example.invalid>', references: [], inReplyTo: null,
    bodyText: 'Body', sanitizedHtml: '<p>Body</p>', bodyTruncated: false, attachments: [], seen: true, uid: 1, uidValidity: '600', size: 10 }),
  readImapPage: () => Promise.resolve({ path: 'Sent', uidValidity: '600', uidNext: 4_294_967_291,
  unread: 0, total: 1, hasMore: false, messages: [{ uid: 4_294_967_290, seen: true, size: 100, attachmentCount: 0, messageId: '<sent@mail-integration.invalid>', references: [], inReplyTo: null,
    from: [{ address: 'support@mail-integration.invalid', name: 'Support' }], to: [{ address: 'customer@example.invalid', name: 'Customer' }], cc: [], replyTo: [], subject: 'Fixture', dateISO: '2031-11-04T12:00:00.000Z' }] }) }));
import { prepareDelivery, processMailDelivery, retryMailDelivery, saveDelivery } from '../src/server/mail/delivery';
import { reserveQuota } from '../src/server/mail/quota';
import { enforceMailRateLimit, readMailThread } from '../src/server/mail/service';

const prefix = 'test-lark-db:';
const actor = 'test-lark-mail-admin';
async function clean(): Promise<void> {
  await prisma.mailDelivery.deleteMany({ where: { mailbox } });
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: prefix } } });
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: 'mail-retry:' }, payload: { path: ['fixture'], equals: prefix } } });
  await prisma.mailMessage.deleteMany({ where: { mailbox } });
  await prisma.mailFolder.deleteMany({ where: { mailbox } });
  await prisma.mailLease.deleteMany({ where: { key: { in: [`smtp:${mailbox}`, `imap:${mailbox}`] } } });
  await prisma.mailQuotaDay.deleteMany({ where: { id: { in: [`mailbox:${mailbox}:2031-11-04`, 'organization:2031-11-04'] } } });
  await prisma.mailQuotaRecipient.deleteMany({ where: { day: '2031-11-04', scope: { in: [`mailbox:${mailbox}`, 'organization'] } } });
  await prisma.mailRateWindow.deleteMany({ where: { key: { startsWith: actor } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: actor } });
}
async function createDelivery(suffix: string) {
  const prepared = await prepareDelivery(`${prefix}${suffix}`, { to: ['customer@example.invalid'], subject: 'Fixture', text: 'Test only' });
  return prisma.$transaction(async (tx) => {
    const event = await tx.outboxEvent.create({ data: { type: 'email.reply', dedupeKey: `${prefix}${suffix}`, payload: {} } });
    const delivery = await saveDelivery(tx, prepared, event.id);
    await tx.outboxEvent.update({ where: { id: event.id }, data: { payload: { deliveryId: delivery.id } } });
    return delivery;
  });
}

describe('Lark persistence against the explicitly isolated test database', () => {
  beforeAll(async () => { await prisma.user.upsert({ where: { id: actor }, create: { id: actor, email: 'admin@mail-integration.invalid', name: 'Mail test', role: 'ADMIN', status: 'ACTIVE' }, update: {} }); });
  beforeEach(async () => { await clean(); fixtures.quotaLimit = 20; fixtures.send.mockReset().mockResolvedValue(250); fixtures.found.mockReset().mockResolvedValue(false); });
  afterAll(async () => { await clean(); await prisma.user.deleteMany({ where: { id: actor } }); await prisma.$disconnect(); });

  it('rolls back an outbox event together with its immutable MIME delivery', async () => {
    const prepared = await prepareDelivery(`${prefix}rollback`, { to: ['customer@example.invalid'], subject: 'Rollback', text: 'Never send' });
    await expect(prisma.$transaction(async (tx) => {
      const event = await tx.outboxEvent.create({ data: { type: 'email.reply', dedupeKey: `${prefix}rollback`, payload: {} } });
      await saveDelivery(tx, prepared, event.id); throw new Error('Injected rollback');
    })).rejects.toThrow('Injected rollback');
    expect(await prisma.mailDelivery.count({ where: { mailbox } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `${prefix}rollback` } })).toBe(0);
  });

  it('allows one provider submission under simultaneous workers and persists a 32-bit unsigned Sent UID', async () => {
    const delivery = await createDelivery('concurrent');
    fixtures.send.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); return 250; });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => processMailDelivery(delivery.id)));
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(results.filter((result) => result.status === 'rejected').every((result) => 'reason' in result && result.reason instanceof Error && result.reason.message === 'MAIL_BUSY')).toBe(true);
    await processMailDelivery(delivery.id);
    expect(fixtures.send).toHaveBeenCalledOnce();
    expect(await prisma.mailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({ status: 'SENT', attempts: 1, sentCopySaved: true });
    expect(await prisma.mailDeliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(1);
    expect(await prisma.mailMessage.findFirst({ where: { mailbox } })).toMatchObject({ uid: 4_294_967_290n, uidValidity: '600' });
  });

  it('reserves the last daily allowance atomically across simultaneous transactions', async () => {
    fixtures.quotaLimit = 1;
    const outcomes = await Promise.allSettled(['a', 'b', 'c'].map((name) => prisma.$transaction((tx) => reserveQuota(tx, mailbox, [`${name}@example.invalid`]), { timeout: 20_000 })));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.mailQuotaDay.findUnique({ where: { id: `mailbox:${mailbox}:${day.toISOString().slice(0, 10)}` } })).toMatchObject({ messages: 1 });
    expect(await prisma.mailQuotaRecipient.count({ where: { scope: `mailbox:${mailbox}`, day: '2031-11-04' } })).toBe(1);
  });

  it('recovers interrupted acceptance to manual review without SMTP and requires explicit duplicate-risk acknowledgement', async () => {
    const delivery = await createDelivery('uncertain');
    await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { status: 'SENDING' } });
    await expect(processMailDelivery(delivery.id)).rejects.toMatchObject({ code: 'MAIL_DELIVERY_UNCERTAIN' });
    await expect(retryMailDelivery(delivery.id, actor, false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(fixtures.send).not.toHaveBeenCalled();
    const retry = await retryMailDelivery(delivery.id, actor, true);
    expect(retry.status).toBe('QUEUED');
    await prisma.outboxEvent.update({ where: { id: retry.outboxEventId }, data: { payload: { deliveryId: delivery.id, fixture: prefix } } });
    expect(await prisma.mailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({ messageId: delivery.messageId });
  });

  it('uses an atomic request counter across concurrent admin requests', async () => {
    const results = await Promise.allSettled(Array.from({ length: 24 }, () => enforceMailRateLimit(actor, true, day)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20);
    expect(await prisma.mailRateWindow.findUnique({ where: { key: `${actor}:write` } })).toMatchObject({ count: 24 });
  });

  it('deduplicates thread Message-IDs before applying database pagination', async () => {
    const base = { mailbox, uidValidity: '600', uid: 1n, threadId: 'duplicate-thread', messageId: '<duplicate@example.invalid>', inReplyTo: null, references: [],
      fromAddresses: [], toAddresses: [], ccAddresses: [], subject: 'Duplicate', sentAt: day, seen: true, size: 10 };
    await prisma.mailMessage.createMany({ data: [{ ...base, id: 'test-mail-copy-inbox', folder: 'inbox' }, { ...base, id: 'test-mail-copy-sent', folder: 'sent' }] });
    for (const folder of ['inbox', 'sent']) await prisma.mailFolder.create({ data: { mailbox, folder, path: folder, uidValidity: '600', lastSyncAt: new Date() } });
    const response = await readMailThread('duplicate-thread', { limit: 20 });
    expect(response.messages).toHaveLength(1);
    expect(response.nextCursor).toBeNull();
  });
});
