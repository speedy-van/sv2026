import 'server-only';
import { AppError } from '@sv/contracts';
import { enqueueOutbox, type DbTx } from '@sv/db';
import { requestRefund } from '../services/payments';

type SettlementMode = 'EXTRA_CHARGE' | 'REFUND' | 'NONE';
export interface BookingMoneySnapshot { id: string; totalPence: number; paidPence: number; refundedPence: number; version: number }
export function adminBookingSettlement(booking: Pick<BookingMoneySnapshot, 'totalPence' | 'paidPence' | 'refundedPence'>, newTotalPence: number): { settle: SettlementMode; settlementAmountPence: number } {
  const balance = newTotalPence === booking.totalPence ? 0 : newTotalPence - (booking.paidPence - booking.refundedPence);
  return { settle: balance > 0 ? 'EXTRA_CHARGE' : balance < 0 ? 'REFUND' : 'NONE', settlementAmountPence: Math.abs(balance) };
}
export async function previewAdminBookingSettlement(tx: DbTx, booking: BookingMoneySnapshot, newTotalPence: number): Promise<ReturnType<typeof adminBookingSettlement>> {
  const payments = await tx.payment.findMany({ where: { bookingId: booking.id }, select: { amountPence: true, method: true, status: true, refunds: { select: { amountPence: true, status: true } } } });
  const paidPence = payments.reduce((sum, payment) => sum + (payment.status === 'SUCCEEDED' ? payment.amountPence : 0), 0);
  const refundedPence = payments.reduce((sum, payment) => sum + payment.refunds.reduce((subtotal, refund) => subtotal + (refund.status === 'SUCCEEDED' ? refund.amountPence : 0), 0), 0);
  if (paidPence !== booking.paidPence || refundedPence !== booking.refundedPence) throw new AppError('CONFLICT', 'Payment records are being reconciled. Refresh this booking before changing its price.');
  const settlement = adminBookingSettlement(booking, newTotalPence);
  const stripeRefundable = payments.reduce((sum, payment) => sum + (payment.status === 'SUCCEEDED' && payment.method === 'STRIPE'
    ? Math.max(0, payment.amountPence - payment.refunds.reduce((amount, refund) => amount + (refund.status === 'FAILED' || refund.status === 'CANCELED' ? 0 : refund.amountPence), 0)) : 0), 0);
  if (settlement.settle === 'REFUND' && settlement.settlementAmountPence > stripeRefundable) throw new AppError('CONFLICT', 'This reduction requires an offline refund. Reconcile that payment before changing the booking price.');
  return settlement;
}
export async function settleAdminBookingChange(
  tx: DbTx,
  booking: BookingMoneySnapshot,
  input: { newTotalPence: number; expectedSettlementPence: number; settle: SettlementMode; reason: string; actorUserId: string },
  now = new Date(),
): Promise<{ extraChargeId: string | null }> {
  const settlement = await previewAdminBookingSettlement(tx, booking, input.newTotalPence);
  if (settlement.settle !== input.settle || settlement.settlementAmountPence !== input.expectedSettlementPence) throw new AppError('PRICE_CHANGED', 'The amount to collect or refund changed. Review the new amount.', settlement);
  if (settlement.settle === 'REFUND') {
    await requestRefund(tx, booking.id, settlement.settlementAmountPence, input.reason, { dedupePrefix: `admin-booking:${booking.id}:${String(booking.version + 1)}:refund` });
  }
  if (settlement.settle !== 'EXTRA_CHARGE') return { extraChargeId: null };
  const extra = await tx.extraCharge.create({ data: {
    bookingId: booking.id, amountPence: settlement.settlementAmountPence, description: input.reason,
    status: 'AWAITING_PAYMENT', requestedById: input.actorUserId, decidedById: input.actorUserId, decidedAt: now,
    includedInBookingTotal: true,
  }, select: { id: true } });
  await enqueueOutbox(tx, 'extra_charge.awaiting_payment', { bookingId: booking.id, extraChargeId: extra.id }, `admin-booking:${booking.id}:${String(booking.version + 1)}:extra`);
  return { extraChargeId: extra.id };
}
