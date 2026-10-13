import 'server-only';

import { AppError } from '@sv/contracts';
import { enqueueOutbox, type DbTx } from '@sv/db';
import type { Prisma } from '@sv/db';
import { createStripeRefund } from '../integrations/stripe';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function recomputeBookingMoney(tx: DbTx, bookingId: string): Promise<{ paidPence: number; refundedPence: number }> {
  const payments = await tx.payment.findMany({
    where: { bookingId },
    select: {
      amountPence: true,
      refunds: { select: { amountPence: true, status: true } },
      status: true,
    },
  });
  const paidPence = payments.reduce((sum, payment) => payment.status === 'SUCCEEDED' ? sum + payment.amountPence : sum, 0);
  const refundedPence = payments.reduce(
    (sum, payment) => sum + payment.refunds.reduce((inner, refund) => refund.status === 'SUCCEEDED' ? inner + refund.amountPence : inner, 0),
    0,
  );
  await tx.booking.update({ data: { paidPence, refundedPence }, where: { id: bookingId } });
  return { paidPence, refundedPence };
}

export async function requestRefund(
  tx: DbTx,
  bookingId: string,
  amountPence: number,
  reason: string,
  options: { dedupePrefix?: string; notifyCustomer?: boolean } = {},
): Promise<void> {
  if (amountPence <= 0) return;
  const payments = await tx.payment.findMany({
    orderBy: { createdAt: 'desc' },
    where: { bookingId, method: 'STRIPE', status: 'SUCCEEDED' },
    select: {
      amountPence: true,
      id: true,
      refunds: { select: { amountPence: true, status: true } },
    },
  });

  let remaining = amountPence;
  for (const payment of payments) {
    const alreadyRefunded = payment.refunds.reduce(
      (sum, refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELED' ? sum + refund.amountPence : sum,
      0,
    );
    const refundable = Math.max(0, payment.amountPence - alreadyRefunded);
    const allocation = Math.min(remaining, refundable);
    if (allocation <= 0) continue;
    const refund = await tx.refund.create({
      data: {
        amountPence: allocation,
        paymentId: payment.id,
        reason,
      },
      select: { id: true },
    });
    await enqueueOutbox(
      tx,
      'payment.refund',
      json({ bookingId, notifyCustomer: options.notifyCustomer ?? true, refundId: refund.id }),
      `${options.dedupePrefix ?? 'payment.refund'}:${refund.id}`,
    );
    remaining -= allocation;
    if (remaining === 0) break;
  }

  if (remaining > 0) {
    throw new AppError('PAYMENT_FAILED', 'Refund amount exceeds captured Stripe payments.', { remainingPence: remaining });
  }
}

export async function runRefundOutbox(tx: DbTx, refundId: string): Promise<void> {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    select: {
      amountPence: true,
      id: true,
      payment: { select: { bookingId: true, stripePaymentIntentId: true } },
      status: true,
      stripeRefundId: true,
    },
  });
  if (!refund) throw new AppError('NOT_FOUND', 'Refund not found.');
  if (refund.status === 'SUCCEEDED' || refund.stripeRefundId) return;
  const result = await createStripeRefund({
    amountPence: refund.amountPence,
    bookingId: refund.payment.bookingId,
    id: refund.id,
    payment: { stripePaymentIntentId: refund.payment.stripePaymentIntentId },
  });
  await tx.refund.update({
    data: { status: result.status, stripeRefundId: result.id },
    where: { id: refund.id },
  });
  await recomputeBookingMoney(tx, refund.payment.bookingId);
  if (result.status === 'SUCCEEDED') {
    await enqueueOutbox(
      tx,
      'payment.refund.created',
      json({ bookingId: refund.payment.bookingId, refundId: refund.id }),
      `payment.refund.created:${refund.id}`,
    );
  }
}
