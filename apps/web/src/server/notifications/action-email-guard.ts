import 'server-only';
import { z } from 'zod';
import type { DbTx } from '@sv/db';
import { contactEmailHash } from '../auth/customer-links';

export const ActionEmailGuardSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking-confirmation'), id: z.string(), emailHash: z.string() }).strict(),
  z.object({ kind: z.literal('booking'), id: z.string(), version: z.number().int(), emailHash: z.string(), template: z.enum(['CONFIRMATION', 'PAYMENT_LINK', 'MANAGE_LINK']) }).strict(),
  z.object({ kind: z.literal('manual-quote'), id: z.string(), expectedUpdatedAt: z.iso.datetime(), status: z.enum(['PRICED', 'DECLINED']) }).strict(),
]);
export type ActionEmailGuard = z.infer<typeof ActionEmailGuardSchema>;
export function readActionEmailGuard(payload: unknown): ActionEmailGuard | null {
  if (!payload || typeof payload !== 'object' || !('actionEmailGuard' in payload)) return null;
  // Invalid internal guards must fail closed, not silently send an old message.
  return ActionEmailGuardSchema.parse(payload.actionEmailGuard);
}
export async function actionEmailStillValid(db: Pick<DbTx, 'booking' | 'manualQuote'>, guard: ActionEmailGuard, now = new Date()): Promise<boolean> {
  if (guard.kind === 'manual-quote') {
    const quote = await db.manualQuote.findUnique({ where: { id: guard.id }, select: { status: true, updatedAt: true, validUntil: true } });
    return Boolean(quote && quote.status === guard.status && quote.updatedAt.toISOString() === guard.expectedUpdatedAt
      && (guard.status !== 'PRICED' || (quote.validUntil && quote.validUntil > now)));
  }
  const booking = await db.booking.findUnique({ where: { id: guard.id }, select: { version: true, contactEmail: true, status: true, deletedAt: true, holdExpiresAt: true } });
  if (!booking || booking.deletedAt || (guard.kind === 'booking' && booking.version !== guard.version) || contactEmailHash(booking.contactEmail) !== guard.emailHash) return false;
  if (guard.kind === 'booking-confirmation') return ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status);
  if (guard.template === 'PAYMENT_LINK') return booking.status === 'PENDING_PAYMENT' && Boolean(booking.holdExpiresAt && booking.holdExpiresAt > now);
  if (guard.template === 'CONFIRMATION') return ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status);
  return true;
}
