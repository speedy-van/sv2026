import 'server-only';
import { prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { MailDeferredError } from './errors';

// A database lease bounds provider connections across all serverless instances.
// Each provider operation has a shorter hard deadline than this lease.
export async function withMailLease<T>(key: string, operation: () => Promise<T>, now = new Date()): Promise<T> {
  const owner = randomUUID();
  // SMTP may be followed by APPEND plus a Sent-header refresh (three 25s
  // operations) and bounded database transactions. Keep the lease beyond all of them.
  const expiresAt = new Date(now.getTime() + 150_000);
  const leases = await prisma.$queryRaw<{ owner: string }[]>`
    INSERT INTO "MailLease" ("key", "owner", "expiresAt") VALUES (${key}, ${owner}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "MailLease"."expiresAt" < ${now} RETURNING "owner"`;
  if (!leases.some((lease) => lease.owner === owner)) throw new MailDeferredError(new Date(now.getTime() + 15_000), 'MAIL_BUSY');
  try { return await operation(); }
  finally { await prisma.mailLease.deleteMany({ where: { key, owner } }); }
}
