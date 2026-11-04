import 'server-only';
import { createHash } from 'node:crypto';
import { AppError, mailReplyRecipients, MailDeliveryStateSchema, type MailFolder, type MailReplyRequest, type MailMessage, type MailListQuerySchema, type MailPageQuerySchema } from '@sv/contracts';
import { Prisma, prisma } from '@sv/db';
import { z } from 'zod';
import { serverEnv } from '../env';
import { mailConfig, mailConfigured } from './config';
import { prepareDelivery, retryMailDelivery, saveDelivery } from './delivery';
import { downloadImapAttachment, fetchImapMessage, readImapPage, setImapSeen, type MailHeaders } from './imap';
import { withMailLease } from './lease';
import { quotaUsage } from './quota';
import { decodeMailCursor, mailCursor, mailErrorCode, persistPage, requireMailMessage, summary, syncMailFolder, type CachedMessage } from './repository';
import { MailEnvelopeSchema } from './smtp';

const PageCursorSchema = z.object({ id: z.string().min(1).max(128), at: z.iso.datetime(), scope: z.string().max(128) }).strict();
function pageCursor(row: { id: string; at: Date }, scope: string): string { return Buffer.from(JSON.stringify({ id: row.id, at: row.at.toISOString(), scope })).toString('base64url'); }
function parseCursor(value: string | undefined, scope: string) {
  if (!value) return null;
  try { const parsed = PageCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); if (parsed.scope !== scope) throw new Error('scope'); return parsed; }
  catch { throw new AppError('VALIDATION_ERROR', 'Invalid page. Refresh and try again.'); }
}
const orphanWhere: Prisma.OutboxEventWhereInput = { mailDelivery: { is: null }, OR: [
  { type: 'email.send', status: { in: ['FAILED', 'PENDING'] } },
  { type: 'booking.confirmed', status: 'FAILED' },
] };

export async function mailStatus() {
  const mailbox = serverEnv().LARK_MAIL_ADDRESS?.toLowerCase() ?? '';
  const [folders, quota, failedCount, uncertainCount, unprepared] = await Promise.all([
    prisma.mailFolder.findMany({ where: { mailbox } }), quotaUsage(mailbox),
    prisma.mailDelivery.count({ where: { mailbox, OR: [{ status: 'FAILED' }, { status: 'SENT', sentCopySaved: false }] } }),
    prisma.mailDelivery.count({ where: { mailbox, status: { in: ['UNCERTAIN', 'SENDING'] } } }),
    prisma.outboxEvent.count({ where: { ...orphanWhere, status: 'FAILED' } }),
  ]);
  const dates = folders.flatMap((folder) => folder.lastSyncAt ? [folder.lastSyncAt] : []).sort((a, b) => b.getTime() - a.getTime());
  return { configured: mailConfigured(), mailbox: mailbox || null,
    folders: (['inbox', 'sent'] as const).map((id) => ({ id, unreadCount: folders.find((folder) => folder.folder === id)?.unreadCount ?? 0 })),
    lastSyncAt: dates[0]?.toISOString() ?? null,
    syncError: folders.find((folder) => folder.lastErrorCode)?.lastErrorCode ?? (mailConfigured() ? null : 'MAIL_CONFIGURATION_REQUIRED'),
    quota, failedCount: failedCount + unprepared, uncertainCount };
}

export async function listMail(input: z.infer<typeof MailListQuerySchema>) {
  const { mailbox } = mailConfig();
  const cursor = decodeMailCursor(input.cursor, input.folder);
  const cached = await prisma.mailFolder.findUnique({ where: { mailbox_folder: { mailbox, folder: input.folder } } });
  if (cursor && cached?.uidValidity !== cursor.validity) throw new AppError('CONFLICT', 'This mailbox changed. Refresh the mailbox.');
  if (input.q) {
    // Deliberately bounded to synced subjects and opened-message previews; no full mailbox or
    // body download on a user-controlled query.
    const rows = await prisma.mailMessage.findMany({ where: { mailbox, folder: input.folder,
      ...(cursor ? { uid: { lt: cursor.uid }, uidValidity: cursor.validity } : {}),
      OR: [{ subject: { contains: input.q, mode: 'insensitive' } }, { snippet: { contains: input.q, mode: 'insensitive' } }],
    }, orderBy: { uid: 'desc' }, take: input.limit + 1 });
    const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items: items.map(summary), nextCursor: rows.length > input.limit && last ? mailCursor(input.folder, last.uidValidity, Number(last.uid)) : null,
      sync: { at: cached?.lastSyncAt?.toISOString() ?? null, error: cached?.lastErrorCode ?? null, hasMore: cached?.hasMore ?? false } };
  }
  return withMailLease(`imap:${mailbox}`, async () => {
    try {
      const page = await readImapPage(input.folder, { limit: input.limit, ...(cursor ? { beforeUid: cursor.uid } : {}) });
      // Do not apply an old UID page to a newly created mailbox.
      if (cursor && (cursor.validity !== page.uidValidity || (cached && cached.path !== page.path))) {
        const latest = await readImapPage(input.folder, { limit: input.limit });
        await persistPage(mailbox, input.folder, latest, 'latest');
        throw new AppError('CONFLICT', 'This mailbox changed. Refresh the mailbox.');
      }
      const { rows } = await persistPage(mailbox, input.folder, page, cursor ? 'older' : 'latest');
      const last = rows.at(-1);
      return { items: rows.map(summary), nextCursor: page.hasMore && last ? mailCursor(input.folder, page.uidValidity, Number(last.uid)) : null,
        sync: { at: new Date().toISOString(), error: null, hasMore: page.hasMore } };
    } catch (error) {
      if (cached) await prisma.mailFolder.updateMany({ where: { id: cached.id }, data: { lastErrorCode: mailErrorCode(error) } });
      throw error;
    }
  });
}

async function fetchMessage(row: CachedMessage): Promise<MailMessage> {
  const { mailbox } = mailConfig();
  try {
    const { detail, snippet } = await withMailLease(`imap:${mailbox}`, async () => {
      const detail = await fetchImapMessage(row.folder as MailFolder, Number(row.uid), row.uidValidity);
      const snippet = detail.bodyText.replace(/\s+/gu, ' ').slice(0, 300);
      // Keep the cache write inside the same lease as the provider read. An
      // overlapping mark-read request must not be overwritten by stale flags.
      await prisma.mailMessage.update({ where: { id: row.id }, data: { seen: detail.seen, snippet, attachmentCount: detail.attachments.length } });
      return { detail, snippet };
    });
    return { ...summary(row), read: detail.seen, snippet, cc: detail.cc, replyTo: detail.replyTo,
      bodyText: detail.bodyText.slice(0, 200_000), bodyHtml: detail.sanitizedHtml || null, bodyTruncated: detail.bodyTruncated || detail.bodyText.length > 200_000, messageId: detail.messageId,
      attachmentCount: detail.attachments.length,
      attachments: detail.attachments.map(({ id, filename, contentType, size, blockedReason }) => ({ id, filename, contentType, size, blockedReason })) };
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') await prisma.mailMessage.deleteMany({ where: { id: row.id } });
    throw error;
  }
}

export async function readMailThread(id: string, input: z.infer<typeof MailPageQuerySchema>) {
  const { mailbox } = mailConfig();
  const cursor = parseCursor(input.cursor, `thread:${id}`);
  if (!cursor) {
    // Keep an open conversation current even when the operator never returns to
    // Inbox. Each refresh advances at most one persisted page per folder.
    for (const folder of ['inbox', 'sent'] as const) {
      const cached = await prisma.mailFolder.findUnique({ where: { mailbox_folder: { mailbox, folder } } });
      if (!cached?.lastSyncAt || Date.now() - cached.lastSyncAt.getTime() >= 15_000) await syncMailFolder(folder);
    }
  }
  const limit = Math.min(input.limit, 5); // Refresh + five bounded downloads fit the 300s route budget.
  // One message can exist in both Inbox and Sent. Deduplicate before applying
  // the cursor; otherwise duplicate Message-IDs can reappear across pages.
  const rows = await prisma.$queryRaw<CachedMessage[]>(Prisma.sql`
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE("messageId", "id")) * FROM "MailMessage"
      WHERE "mailbox" = ${mailbox} AND "threadId" = ${id}
      ORDER BY COALESCE("messageId", "id"), "sentAt" DESC, "id" DESC
    ) AS messages
    ${cursor ? Prisma.sql`WHERE ("sentAt", "id") < (${new Date(cursor.at)}, ${cursor.id})` : Prisma.empty}
    ORDER BY "sentAt" DESC, "id" DESC LIMIT ${limit + 1}`);
  if (!rows.length) throw new AppError('NOT_FOUND', 'Conversation not found. Refresh the mailbox.');
  const messages: MailMessage[] = [];
  let responseBytes = 1024; // Leave room for the response envelope and cursor.
  for (const row of rows.slice(0, limit)) {
    const message = await fetchMessage(await requireMailMessage(row.id));
    const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (responseBytes + bytes > 3 * 1024 * 1024) {
      if (!messages.length) throw new AppError('VALIDATION_ERROR', 'This message is too large to display in the app. Open it in Lark Mail.');
      break;
    }
    messages.push(message); responseBytes += bytes;
  }
  const last = rows[messages.length - 1];
  return { id, subject: rows[0]?.subject ?? '', messages,
    nextCursor: rows.length > messages.length && last ? pageCursor({ id: last.id, at: last.sentAt }, `thread:${id}`) : null };
}

export async function markMailRead(id: string, read: boolean) {
  const row = await requireMailMessage(id);
  await withMailLease(`imap:${row.mailbox}`, async () => {
    await setImapSeen(row.folder as MailFolder, Number(row.uid), row.uidValidity, read);
    await prisma.$transaction(async (tx) => {
      const changed = await tx.mailMessage.updateMany({ where: { id, seen: !read }, data: { seen: read } });
      // Refresh/list sync obtains the authoritative folder count. A conditional
      // update prevents overlapping read requests from adjusting it twice.
      if (changed.count) await tx.$executeRaw`UPDATE "MailFolder" SET "unreadCount" = GREATEST(0, "unreadCount" + ${read ? -1 : 1}) WHERE "mailbox" = ${row.mailbox} AND "folder" = ${row.folder} AND "uidValidity" = ${row.uidValidity}`;
    });
  });
  return { ok: true as const };
}
export async function mailAttachment(id: string, attachmentId: string) {
  const row = await requireMailMessage(id);
  return withMailLease(`imap:${row.mailbox}`, () => downloadImapAttachment(row.folder as MailFolder, Number(row.uid), row.uidValidity, attachmentId));
}

export function replyRecipients(headers: MailHeaders, mode: 'reply' | 'reply-all', mailbox: string) {
  const { to, cc } = mailReplyRecipients(headers, mode, mailbox);
  if (!to.length) throw new AppError('VALIDATION_ERROR', 'This message has no reply address.');
  if (to.length + cc.length > 50) throw new AppError('VALIDATION_ERROR', 'This conversation has too many recipients to reply safely.');
  return { to, cc };
}

export async function queueMailReply(id: string, input: MailReplyRequest, actorUserId: string) {
  const { mailbox } = mailConfig();
  if (serverEnv().LARK_MAIL_SEND_ENABLED !== 'true') throw new AppError('UPSTREAM_UNAVAILABLE', 'Mail sending has not been enabled by the administrator.');
  const key = `reply:${actorUserId}:${input.clientMessageId}`;
  const requestHash = createHash('sha256').update(JSON.stringify({ id, mode: input.mode, text: input.text })).digest('hex');
  const prior = await prisma.mailDelivery.findUnique({ where: { key } });
  if (prior) {
    if (MailEnvelopeSchema.parse(prior.envelope).requestHash !== requestHash) throw new AppError('CONFLICT', 'This reply identifier was already used for another message.');
    return { deliveryId: prior.id, status: MailDeliveryStateSchema.parse(prior.status), outboxEventId: prior.outboxEventId };
  }
  const row = await requireMailMessage(id);
  const headers = await withMailLease(`imap:${mailbox}`, () => fetchImapMessage(row.folder as MailFolder, Number(row.uid), row.uidValidity));
  if (!headers.messageId) throw new AppError('VALIDATION_ERROR', 'This message has no valid Message-ID and cannot be replied to safely.');
  const recipients = replyRecipients(headers, input.mode, mailbox);
  const subject = /^re:/iu.test(headers.subject) ? headers.subject : `Re: ${headers.subject}`;
  const references = [...new Set([...headers.references, ...(headers.inReplyTo ? [headers.inReplyTo] : []), headers.messageId])].slice(-50);
  const prepared = await prepareDelivery(key, { ...recipients, subject: subject.slice(0, 998), text: input.text,
    inReplyTo: headers.messageId, references }, requestHash);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const event = await tx.outboxEvent.upsert({ where: { dedupeKey: key }, create: { dedupeKey: key, type: 'email.reply', payload: {} }, update: {} });
    const delivery = await saveDelivery(tx, prepared, event.id);
    if (MailEnvelopeSchema.parse(delivery.envelope).requestHash !== requestHash) throw new AppError('CONFLICT', 'This reply identifier was already used for another message.');
    await tx.outboxEvent.update({ where: { id: event.id }, data: { payload: { deliveryId: delivery.id } } });
    await tx.auditLog.create({ data: { actorType: 'USER', actorUserId, action: 'mail.reply', entityType: 'MailDelivery', entityId: delivery.id,
      after: { mode: input.mode, sourceMessageId: id }, reason: 'Admin queued a reply.' } });
    return { deliveryId: delivery.id, status: MailDeliveryStateSchema.parse(delivery.status), outboxEventId: event.id };
  });
}

export async function listMailDeliveries(input: z.infer<typeof MailPageQuerySchema>) {
  const mailbox = serverEnv().LARK_MAIL_ADDRESS?.toLowerCase() ?? '';
  const cursor = parseCursor(input.cursor, 'deliveries');
  const older = cursor ? { OR: [{ createdAt: { lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { lt: cursor.id.replace(/^outbox_/u, '') } }] } : {};
  const [deliveries, unprepared] = await Promise.all([
    prisma.mailDelivery.findMany({ where: { mailbox, ...older }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 }),
    prisma.outboxEvent.findMany({ where: { ...orphanWhere, ...older }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 }),
  ]);
  const items = deliveries.map((row) => ({ id: row.id, subject: row.subject, to: MailEnvelopeSchema.parse(row.envelope).to.map((address) => ({ address })),
    status: MailDeliveryStateSchema.parse(row.status), attempts: row.attempts, lastErrorCode: row.lastErrorCode, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null,
    canRetry: ['FAILED', 'RETRY', 'DEFERRED', 'UNCERTAIN'].includes(row.status) || (row.status === 'SENT' && !row.sentCopySaved) }));
  for (const row of unprepared) items.push({ id: `outbox_${row.id}`, subject: row.type === 'booking.confirmed' ? 'Booking confirmation could not be prepared' : 'Booking notification awaiting mail preparation', to: [],
    status: row.status === 'FAILED' ? 'FAILED' : 'QUEUED', attempts: row.attempts,
    // Legacy lastError may contain arbitrary provider text. Never expose it.
    lastErrorCode: row.status === 'FAILED' ? 'MAIL_PREPARATION_FAILED' : null,
    nextAttemptAt: row.nextAttemptAt.toISOString(), createdAt: row.createdAt.toISOString(), sentAt: null, canRetry: row.status === 'FAILED' });
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.replace(/^outbox_/u, '').localeCompare(a.id.replace(/^outbox_/u, '')));
  const selected = items.slice(0, input.limit); const last = selected.at(-1);
  return { items: selected, nextCursor: items.length > input.limit && last ? pageCursor({ id: last.id, at: new Date(last.createdAt) }, 'deliveries') : null };
}

export async function retryDelivery(id: string, actorUserId: string, risk: boolean) {
  if (!id.startsWith('outbox_')) return retryMailDelivery(id, actorUserId, risk);
  mailConfig();
  const eventId = id.slice(7);
  return prisma.$transaction(async (tx) => {
    const result = await tx.outboxEvent.updateMany({ where: { ...orphanWhere, id: eventId, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date(), claimedAt: null } });
    if (!result.count) throw new AppError('CONFLICT', 'This notification changed. Refresh its delivery status.');
    await tx.auditLog.create({ data: { actorType: 'USER', actorUserId, action: 'mail.retry', entityType: 'OutboxEvent', entityId: eventId, reason: 'Admin retried email preparation.' } });
    return { deliveryId: id, status: 'QUEUED' as const, outboxEventId: eventId };
  });
}

export async function enforceMailRateLimit(userId: string, mutation: boolean, now = new Date()): Promise<void> {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const key = `${userId}:${mutation ? 'write' : 'read'}`;
  // One bounded row per staff member/action; database-wide rather than per warm function.
  const [window] = await prisma.$queryRaw<Array<{ count: number }>>`INSERT INTO "MailRateWindow" ("key", "windowStart", "count") VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = ${start}, "count" = CASE WHEN "MailRateWindow"."windowStart" < ${start} THEN 1 ELSE "MailRateWindow"."count" + 1 END RETURNING "count"`;
  if (!window || window.count > (mutation ? 20 : 120)) throw new AppError('RATE_LIMITED', 'Too many mail requests. Try again shortly.', { retryAfter: Math.ceil((start.getTime() + 60_000 - now.getTime()) / 1000) });
}
