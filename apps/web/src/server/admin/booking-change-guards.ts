import 'server-only';
import { AppError } from '@sv/contracts';
import type { DbTx } from '@sv/db';

/** Unresolved changes must finish before another edit can change the same financial or slot basis. */
export async function assertAdminBookingChangeReady(tx: DbTx, bookingId: string): Promise<void> {
  const [payments, refunds, extras, holds] = await Promise.all([
    tx.payment.count({ where: { bookingId, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING'] } } }),
    tx.refund.count({ where: { payment: { bookingId }, status: 'PENDING' } }),
    tx.extraCharge.count({ where: { bookingId, status: { in: ['REQUESTED', 'AWAITING_PAYMENT'] } } }),
    tx.slotHold.count({ where: { bookingId } }),
  ]);
  if (payments || refunds || extras || holds) throw new AppError('CONFLICT', 'Finish the pending payment, refund or booking change before editing this move.');
}
