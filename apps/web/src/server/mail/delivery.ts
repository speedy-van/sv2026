import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@sv/contracts';
import { prisma, type Prisma, type DbTx } from '@sv/db';
import { serverEnv } from '../env';
import { mailConfig } from './config';
import { withMailLease } from './lease';
import { appendSentMessage, findSentMessage, readImapPage } from './imap';
import { persistPage } from './repository';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from './errors';
import { MailEnvelopeSchema, compileMail, sendSmtp, type MailEnvelope, type PreparedMail } from './smtp';
import { reserveQuota, uniqueRecipients } from './quota';

export function deliveryMessageId(key: string, mailbox: string): string {
  const domain = mailbox.split('@')[1];
  if (!domain) throw new MailPermanentError('MAIL_CONFIGURATION_REQUIRED');
  return `<sv.${createHash('sha256').update(key).digest('hex')}@${domain}>`;
}
export async function prepareDelivery(key: string, mail: PreparedMail, requestHash?: string) {
  const { mailbox } = mailConfig();
  const envelope: MailEnvelope = MailEnvelopeSchema.parse({
    to: mail.to.map((a) => a.trim().toLowerCase()), cc: (mail.cc ?? []).map((a) => a.trim().toLowerCase()), bcc: (mail.bcc ?? []).map((a) => a.trim().toLowerCase()),
    ...(requestHash ? { requestHash } : {}),
  });
  const messageId = deliveryMessageId(key, mailbox);
  const rawMime = await compileMail(mail, messageId, new Date());
  return { key, mailbox, messageId, subject: mail.subject, envelope: envelope as Prisma.InputJsonValue, rawMime: new Uint8Array(rawMime) };
}

export async function saveDelivery(tx: DbTx, prepared: Awaited<ReturnType<typeof prepareDelivery>>, outboxEventId?: string) {
  return tx.mailDelivery.upsert({ where: { key: prepared.key }, update: {},
    create: { ...prepared, ...(outboxEventId ? { outboxEventId } : {}) } });
}

async function saveSentCopy(delivery: { id: string; rawMime: Uint8Array; sentCopySaved: boolean }): Promise<void> {
  if (delivery.sentCopySaved) return;
  try {
    const { mailbox } = mailConfig();
    await withMailLease(`imap:${mailbox}`, async () => {
      await appendSentMessage(Buffer.from(delivery.rawMime));
      // Publish the server-assigned Sent UID to the shared cache, so the reply
      // appears in its conversation without first visiting the Sent folder.
      const page = await readImapPage('sent', { limit: 50 });
      await persistPage(mailbox, 'sent', page, 'latest');
    });
    await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { sentCopySaved: true, lastErrorCode: null } });
  } catch (error) {
    await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { lastErrorCode: 'MAIL_SENT_COPY_PENDING' } });
    if (error instanceof MailDeferredError) throw error;
    throw new MailTransientError('MAIL_SENT_COPY_PENDING');
  }
}

export async function processMailDelivery(id: string): Promise<void> {
  const config = mailConfig();
  return withMailLease(`smtp:${config.mailbox}`, async () => {
    let delivery = await prisma.mailDelivery.findFirst({ where: { id, mailbox: config.mailbox } });
    if (!delivery) throw new MailPermanentError('MAIL_DELIVERY_NOT_FOUND');
    if (delivery.status === 'SENT') return saveSentCopy(delivery);
    if (delivery.status === 'SENDING' || delivery.status === 'UNCERTAIN') {
      // A previous process may have died after SMTP accepted DATA. Never resend
      // automatically. A matching Sent copy is positive evidence of acceptance.
      let found = false;
      const previousMessageId = delivery.messageId;
      try { found = await withMailLease(`imap:${config.mailbox}`, () => findSentMessage(previousMessageId)); }
      catch (error) { if (!(error instanceof MailTransientError || error instanceof MailDeferredError || error instanceof MailPermanentError)) throw error; }
      if (found) {
        await prisma.mailDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), sentCopySaved: true, lastErrorCode: null } });
        return;
      }
      await prisma.mailDelivery.update({ where: { id }, data: { status: 'UNCERTAIN', lastErrorCode: 'MAIL_DELIVERY_UNCERTAIN' } });
      throw new MailReviewRequiredError();
    }
    if (delivery.status === 'FAILED') throw new MailPermanentError(delivery.lastErrorCode ?? 'MAIL_REJECTED');
    if (serverEnv().LARK_MAIL_SEND_ENABLED !== 'true') {
      await prisma.mailDelivery.update({ where: { id }, data: { status: 'FAILED', lastErrorCode: 'MAIL_SENDING_DISABLED' } });
      throw new MailPermanentError('MAIL_SENDING_DISABLED');
    }
    if (delivery.attempts >= 6) throw new MailPermanentError('MAIL_RETRIES_EXHAUSTED');
    const envelope = MailEnvelopeSchema.parse(delivery.envelope);
    let attemptId: string | undefined;
    let submissionStarted = false;
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        await reserveQuota(tx, config.mailbox, uniqueRecipients(envelope.to, envelope.cc, envelope.bcc));
        const row = await tx.mailDelivery.update({ where: { id }, data: {
          status: 'SENDING', attempts: { increment: 1 }, sendingStartedAt: new Date(), nextAttemptAt: null, lastErrorCode: null,
        } });
        const attempt = await tx.mailDeliveryAttempt.create({ data: { deliveryId: id, outcome: 'STARTED' } });
        return { row, attempt };
      });
      delivery = claimed.row;
      attemptId = claimed.attempt.id;
      submissionStarted = true;
      const providerCode = await sendSmtp(delivery.rawMime, envelope);
      // Accepted is persisted before Sent-copy maintenance. A copy failure only
      // retries APPEND; it must never trigger another SMTP submission.
      await prisma.$transaction(async (tx) => {
        await tx.mailDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), smtpResponseCode: providerCode, lastErrorCode: null } });
        await tx.mailDeliveryAttempt.update({ where: { id: claimed.attempt.id }, data: { outcome: 'ACCEPTED', providerCode, finishedAt: new Date() } });
      });
    } catch (error) {
      const accepted = await prisma.mailDelivery.findUnique({ where: { id }, select: { status: true } });
      if (accepted?.status === 'SENT') throw error;
      const known = error instanceof MailPermanentError || error instanceof MailTransientError || error instanceof MailDeferredError;
      const uncertain = submissionStarted && (error instanceof MailReviewRequiredError || !known);
      const failure = uncertain ? new MailReviewRequiredError() : known ? error : new MailTransientError('MAIL_STORAGE_UNAVAILABLE');
      const code = failure instanceof MailReviewRequiredError || failure instanceof MailPermanentError || failure instanceof MailTransientError || failure instanceof MailDeferredError ? failure.code : 'MAIL_DELIVERY_UNCERTAIN';
      const terminal = failure instanceof MailPermanentError || (failure instanceof MailTransientError && delivery.attempts >= 6);
      await prisma.$transaction(async (tx) => {
        await tx.mailDelivery.update({ where: { id }, data: {
          status: uncertain ? 'UNCERTAIN' : failure instanceof MailDeferredError ? 'DEFERRED' : terminal ? 'FAILED' : 'RETRY',
          lastErrorCode: code, ...(failure instanceof MailDeferredError ? { nextAttemptAt: failure.retryAt } : {}),
        } });
        if (attemptId) await tx.mailDeliveryAttempt.update({ where: { id: attemptId }, data: { outcome: code, finishedAt: new Date() } });
      });
      throw failure;
    }
    return saveSentCopy(delivery);
  });
}

export async function retryMailDelivery(id: string, actorUserId: string, acknowledgeDuplicateRisk: boolean) {
  const { mailbox } = mailConfig();
  // Serialize manual retries with provider submission; a stale RETRY read must
  // never overwrite SENT while another worker is accepting the same message.
  return withMailLease(`smtp:${mailbox}`, () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-retry:${id}`}))`;
    const delivery = await tx.mailDelivery.findFirst({ where: { id, mailbox } });
    if (!delivery) throw new AppError('NOT_FOUND', 'Email delivery not found.');
    if (delivery.status === 'SENDING') throw new AppError('CONFLICT', 'This email is being sent. Refresh its status first.');
    if (delivery.status === 'SENT' && delivery.sentCopySaved) throw new AppError('CONFLICT', 'This email was already accepted by the mail server.');
    if (delivery.status === 'UNCERTAIN' && !acknowledgeDuplicateRisk) {
      throw new AppError('CONFLICT', 'Delivery is uncertain. Check Lark Sent and confirm the duplicate risk before retrying.');
    }
    const key = `mail-retry:${delivery.id}`;
    const event = await tx.outboxEvent.upsert({ where: { dedupeKey: key },
      create: { dedupeKey: key, type: 'email.reply', payload: { deliveryId: id } },
      update: {} });
    if (event.status === 'PROCESSING') throw new AppError('CONFLICT', 'A retry is already running.');
    const row = await tx.mailDelivery.update({ where: { id }, data: {
      status: delivery.status === 'SENT' ? 'SENT' : 'QUEUED', attempts: 0, lastErrorCode: null, nextAttemptAt: new Date(), sendingStartedAt: null,
    } });
    await tx.outboxEvent.update({ where: { id: event.id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), claimedAt: null, lastError: null } });
    await tx.auditLog.create({ data: { actorType: 'USER', actorUserId, action: 'mail.retry', entityType: 'MailDelivery', entityId: id,
      after: { acknowledgedDuplicateRisk: acknowledgeDuplicateRisk }, reason: 'Admin requested email retry.' } });
    return { deliveryId: row.id, status: row.status, outboxEventId: event.id };
  }));
}
