import 'server-only';
import { createHash } from 'node:crypto';
import { AppError, MailAddressSchema, type MailFolder, type MailMessageSummary } from '@sv/contracts';
import { prisma, type Prisma, type DbTx } from '@sv/db';
import { z } from 'zod';
import { mailConfig } from './config';
import { readImapPage, type ImapPage, type ImapMessageSummary } from './imap';
import { withMailLease } from './lease';
import { MailDeferredError, MailPermanentError, MailTransientError } from './errors';

export type CachedMessage = Prisma.MailMessageGetPayload<object>;
const CursorSchema = z.object({ uid: z.number().int().positive().max(4_294_967_295), validity: z.string().regex(/^\d+$/u), folder: z.enum(['inbox', 'sent']) }).strict();
export function mailCursor(folder: MailFolder, validity: string, uid: number): string {
  return Buffer.from(JSON.stringify({ folder, validity, uid })).toString('base64url');
}
export function decodeMailCursor(value: string | undefined, folder: MailFolder) {
  if (!value) return null;
  try {
    const cursor = CursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.folder !== folder) throw new Error('folder');
    return cursor;
  } catch { throw new AppError('VALIDATION_ERROR', 'Invalid mailbox page. Refresh the mailbox.'); }
}
export function mailErrorCode(error: unknown): string {
  if (error instanceof MailTransientError || error instanceof MailDeferredError || error instanceof MailPermanentError) return error.code;
  if (error instanceof AppError && error.code === 'CONFLICT') return 'MAILBOX_CHANGED';
  return 'MAIL_UNAVAILABLE';
}
export function addresses(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => { const parsed = MailAddressSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
}
export function summary(row: CachedMessage): MailMessageSummary {
  return { id: row.id, threadId: row.threadId, folder: row.folder as MailFolder, subject: row.subject,
    from: addresses(row.fromAddresses), to: addresses(row.toAddresses), sentAt: row.sentAt.toISOString(),
    read: row.seen, attachmentCount: row.attachmentCount, snippet: row.snippet };
}
export function threadKey(mailbox: string, rootId: string): string {
  return createHash('sha256').update(`${mailbox}\0${rootId}`).digest('hex');
}
async function resolveThread(tx: DbTx, mailbox: string, folder: MailFolder, validity: string, message: ImapMessageSummary): Promise<{ threadId: string; mergedThreadIds: string[] }> {
  const ancestors = [...message.references, ...(message.inReplyTo ? [message.inReplyTo] : [])];
  const root = ancestors[0] ?? message.messageId ?? `${folder}:${validity}:${String(message.uid)}`;
  const relatedIds = [...ancestors, ...(message.messageId ? [message.messageId] : [])];
  const related = await tx.mailMessage.findMany({ where: { mailbox, OR: [
    { messageId: { in: relatedIds } },
    ...(message.messageId ? [{ inReplyTo: message.messageId }, { references: { array_contains: [message.messageId] } }] : []),
  ] }, select: { threadId: true, messageId: true }, orderBy: { createdAt: 'asc' } });
  const threadId = related.find((row) => row.messageId && relatedIds.includes(row.messageId))?.threadId ?? threadKey(mailbox, root);
  // Every known ancestor/child thread must converge, including children received
  // before their parent and replies containing References without In-Reply-To.
  const mergedThreadIds = [...new Set(related.map((row) => row.threadId).filter((id) => id !== threadId))];
  if (mergedThreadIds.length) await tx.mailMessage.updateMany({ where: { mailbox, threadId: { in: mergedThreadIds } }, data: { threadId } });
  return { threadId, mergedThreadIds };
}

export async function persistPage(mailbox: string, folder: MailFolder, page: ImapPage, mode: 'latest' | 'older' | 'incremental') {
  return prisma.$transaction(async (tx) => {
    // Threads span Inbox and Sent, so every cache mutation for this mailbox
    // shares a transaction lock even when callers synchronize different folders.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-cache:${mailbox}`}))`;
    const existing = await tx.mailFolder.findUnique({ where: { mailbox_folder: { mailbox, folder } } });
    const reset = !!existing && (existing.uidValidity !== page.uidValidity || existing.path !== page.path);
    if (reset || page.total === 0) await tx.mailMessage.deleteMany({ where: { mailbox, folder } });
    const previous = reset || page.total === 0 ? null : existing;
    const uids = page.messages.map((item) => item.uid);
    const maximum = Math.max(0, ...uids);
    const minimum = uids.length ? Math.min(...uids) : 0;
    // The high-water mark advances only for contiguous new-message scans. A UI
    // request for the newest page must not skip a backlog after a long outage.
    const lastUid = mode === 'incremental' || !previous ? Math.max(Number(previous?.lastUid ?? 0), maximum) : Number(previous.lastUid);
    const reachesBeginning = !page.hasMore && (mode === 'latest' || mode === 'older');
    const oldestUid = minimum ? reachesBeginning ? minimum : Math.min(Number(previous?.oldestUid ?? 0) || minimum, minimum) : Number(previous?.oldestUid ?? 0);
    const data = { path: page.path, uidValidity: page.uidValidity, lastUid, oldestUid, uidNext: page.uidNext,
      unreadCount: page.unread, hasMore: page.total === 0 || reachesBeginning ? false : mode === 'older' || !previous ? page.hasMore : previous.hasMore,
      lastSyncAt: new Date(), lastErrorCode: null };
    await tx.mailFolder.upsert({ where: { mailbox_folder: { mailbox, folder } }, create: { mailbox, folder, ...data }, update: data });
    if (minimum && maximum) {
      // Delete only within the range this page proves complete. The latest page
      // includes the upper edge; a terminal older page includes the lower edge.
      const uid = mode === 'latest' ? { ...(page.hasMore ? { gte: minimum } : {}), notIn: uids }
        : mode === 'older' && !page.hasMore ? { lte: maximum, notIn: uids }
          : { gte: minimum, lte: maximum, notIn: uids };
      await tx.mailMessage.deleteMany({ where: { mailbox, folder, uidValidity: page.uidValidity, uid } });
    } else if (mode === 'older' && !page.hasMore && previous?.oldestUid) {
      await tx.mailMessage.deleteMany({ where: { mailbox, folder, uidValidity: page.uidValidity, uid: { lt: previous.oldestUid } } });
    }
    const rows: CachedMessage[] = [];
    const cachedAt = new Date();
    for (const message of page.messages) {
      const { threadId, mergedThreadIds } = await resolveThread(tx, mailbox, folder, page.uidValidity, message);
      for (const row of rows) if (mergedThreadIds.includes(row.threadId)) row.threadId = threadId;
      const values = { threadId, messageId: message.messageId, inReplyTo: message.inReplyTo, references: message.references,
        fromAddresses: message.from as unknown as Prisma.InputJsonValue, toAddresses: message.to as unknown as Prisma.InputJsonValue,
        ccAddresses: message.cc as unknown as Prisma.InputJsonValue, subject: message.subject,
        ...(message.dateISO ? { sentAt: new Date(message.dateISO) } : {}), seen: message.seen, size: message.size, attachmentCount: message.attachmentCount };
      rows.push(await tx.mailMessage.upsert({ where: { mailbox_folder_uidValidity_uid: { mailbox, folder, uidValidity: page.uidValidity, uid: message.uid } },
        create: { mailbox, folder, uidValidity: page.uidValidity, uid: message.uid, sentAt: cachedAt, createdAt: cachedAt, ...values }, update: values }));
    }
    return { rows, reset };
  }, { timeout: 20_000 });
}

export async function syncMailFolder(folder: MailFolder): Promise<void> {
  const { mailbox } = mailConfig();
  return withMailLease(`imap:${mailbox}`, async () => {
    const previous = await prisma.mailFolder.findUnique({ where: { mailbox_folder: { mailbox, folder } } });
    try {
      let page = await readImapPage(folder, previous ? { afterUid: Number(previous.lastUid), limit: 50 } : { limit: 50 });
      const reset = previous && (previous.uidValidity !== page.uidValidity || previous.path !== page.path);
      if (reset) page = await readImapPage(folder, { limit: 50 });
      await persistPage(mailbox, folder, page, reset || !previous ? 'latest' : 'incremental');
    } catch (error) {
      if (previous) await prisma.mailFolder.update({ where: { id: previous.id }, data: { lastErrorCode: mailErrorCode(error) } });
      throw error;
    }
  });
}

export async function requireMailMessage(id: string): Promise<CachedMessage> {
  const { mailbox } = mailConfig();
  const message = await prisma.mailMessage.findFirst({ where: { id, mailbox } });
  if (!message) throw new AppError('NOT_FOUND', 'Message not found. Refresh the mailbox.');
  const folder = await prisma.mailFolder.findUnique({ where: { mailbox_folder: { mailbox, folder: message.folder } } });
  if (!folder || folder.uidValidity !== message.uidValidity) throw new AppError('CONFLICT', 'This mailbox changed. Refresh the mailbox.');
  return message;
}
