import 'server-only';
import { createHash } from 'node:crypto';
import { type DbTx, prisma } from '@sv/db';
import { z } from 'zod';
import { serverEnv } from '../env';
import { MailDeferredError, MailPermanentError } from './errors';

export function nextQuotaReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1));
}
export function uniqueRecipients(to: readonly string[], cc: readonly string[] = [], bcc: readonly string[] = []): string[] {
  const result = [...new Set([...to, ...cc, ...bcc].map((address) => address.trim().toLowerCase()))];
  if (!result.length || result.length > 50 || result.some((address) => !z.email().safeParse(address).success || /[\r\n\0]/u.test(address))) {
    throw new MailPermanentError('MAIL_INVALID_RECIPIENT');
  }
  return result;
}
export function externalRecipients(addresses: readonly string[], mailbox: string): string[] {
  const domain = mailbox.slice(mailbox.lastIndexOf('@') + 1).toLowerCase();
  return uniqueRecipients(addresses).filter((address) => address.slice(address.lastIndexOf('@') + 1) !== domain);
}
export function quotaScopes(mailbox: string): string[] { return [`mailbox:${mailbox}`, 'organization']; }

// Reserve before every provider attempt. Rejected attempts deliberately remain
// charged locally: conservative accounting is safer than guessing provider usage.
export async function reserveQuota(tx: DbTx, mailbox: string, recipients: readonly string[], now = new Date()): Promise<void> {
  const env = serverEnv();
  const day = now.toISOString().slice(0, 10);
  const external = externalRecipients(recipients, mailbox);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lark-mail-quota'))`;
  for (const [index, scope] of quotaScopes(mailbox).entries()) {
    const id = `${scope}:${day}`;
    const messagesLimit = index === 0 ? env.LARK_MAIL_DAILY_MESSAGES : env.LARK_MAIL_ORG_DAILY_MESSAGES;
    const recipientsLimit = index === 0 ? env.LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS : env.LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS;
    const existing = await tx.mailQuotaDay.findUnique({ where: { id } });
    const known = await tx.mailQuotaRecipient.findMany({ where: { scope, day }, select: { hash: true } });
    const knownHashes = new Set(known.map((entry) => entry.hash));
    const hashes = external.map((address) => createHash('sha256').update(`${scope}:${day}:${address}`).digest('hex'));
    const newHashes = hashes.filter((hash) => !knownHashes.has(hash));
    if ((existing?.messages ?? 0) >= messagesLimit || (external.length > 0 && (known.length >= recipientsLimit || known.length + newHashes.length > recipientsLimit))) {
      throw new MailDeferredError(nextQuotaReset(now));
    }
    if (existing && existing.messages > 0 && now.getTime() - existing.updatedAt.getTime() < env.LARK_MAIL_MIN_SEND_INTERVAL_SECONDS * 1000) {
      throw new MailDeferredError(new Date(existing.updatedAt.getTime() + env.LARK_MAIL_MIN_SEND_INTERVAL_SECONDS * 1000), 'MAIL_SEND_PACED');
    }
    await tx.mailQuotaDay.upsert({ where: { id }, create: { id, messages: 1 }, update: { messages: { increment: 1 } } });
    if (newHashes.length) await tx.mailQuotaRecipient.createMany({ data: newHashes.map((hash) => ({ scope, day, hash })), skipDuplicates: true });
  }
}

export async function quotaUsage(mailbox: string, now = new Date()) {
  const env = serverEnv();
  const day = now.toISOString().slice(0, 10);
  const scope = `mailbox:${mailbox}`;
  const [record, recipients] = await Promise.all([
    prisma.mailQuotaDay.findUnique({ where: { id: `${scope}:${day}` } }),
    prisma.mailQuotaRecipient.count({ where: { scope, day } }),
  ]);
  return { messagesUsed: record?.messages ?? 0, messagesLimit: env.LARK_MAIL_DAILY_MESSAGES,
    externalRecipientsUsed: recipients, externalRecipientsLimit: env.LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS,
    resetsAt: nextQuotaReset(now).toISOString() };
}
