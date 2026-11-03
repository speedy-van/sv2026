import 'server-only';

import { enqueueOutbox, prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import { cancelPaymentIntent } from '../integrations/stripe';
import { releaseCoupon } from './coupon';
import { outboxProcessFrom } from '../env';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function expireBookingHolds(now = new Date(), deadline = Number.POSITIVE_INFINITY): Promise<{ bookingsExpired: number; slotHoldsExpired: number }> {
  const processFrom = outboxProcessFrom();
  const bookings = await prisma.booking.findMany({
    take: 50,
    orderBy: [{ holdExpiresAt: 'asc' }, { id: 'asc' }],
    where: { holdExpiresAt: { lt: now }, status: 'PENDING_PAYMENT',
      payments: { none: { kind: { in: ['BOOKING', 'ADMIN_BOOKING', 'MANUAL_QUOTE'] }, status: { in: ['PROCESSING', 'SUCCEEDED'] } } },
      ...(processFrom ? { createdAt: { gte: processFrom } } : {}) },
    select: {
      couponId: true,
      id: true,
      payments: {
        select: { id: true, kind: true, status: true, stripePaymentIntentId: true },
      },
    },
  });

  let bookingsExpired = 0;
  for (const booking of bookings) {
    if (Date.now() >= deadline) break;
    // An initial payment awaiting webhook confirmation must keep its booking intact.
    const awaitingConfirmation = booking.payments.some((payment) =>
      (payment.kind === 'BOOKING' || payment.kind === 'ADMIN_BOOKING' || payment.kind === 'MANUAL_QUOTE')
      && (payment.status === 'PROCESSING' || payment.status === 'SUCCEEDED'),
    );
    if (awaitingConfirmation) continue;
    let skip = false;
    for (const payment of booking.payments) {
      if (Date.now() >= deadline) { skip = true; break; }
      if (payment.status !== 'REQUIRES_PAYMENT' && payment.status !== 'FAILED') continue;
      const result = await cancelPaymentIntent(payment.stripePaymentIntentId);
      if (result === 'skip') skip = true;
    }
    if (skip) continue;
    await prisma.$transaction(async (tx) => {
      // Payment webhooks lock Payment before Booking. Use the same order and
      // re-read committed payment status after waiting for any in-flight webhook.
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "bookingId" = ${booking.id} ORDER BY "id" FOR UPDATE`;
      const protectedPayment = await tx.payment.findFirst({
        where: { bookingId: booking.id, kind: { in: ['BOOKING', 'ADMIN_BOOKING', 'MANUAL_QUOTE'] }, status: { in: ['PROCESSING', 'SUCCEEDED'] } },
        select: { id: true },
      });
      if (protectedPayment) return;
      const updated = await tx.booking.updateMany({
        data: { holdExpiresAt: null, status: 'EXPIRED', version: { increment: 1 } },
        where: { holdExpiresAt: { lt: now }, id: booking.id, status: 'PENDING_PAYMENT' },
      });
      if (updated.count === 0) return;
      // An abandoned checkout must not burn a one-time coupon.
      if (booking.couponId) await releaseCoupon(tx, booking.couponId, now);
      await tx.payment.updateMany({
        data: { status: 'CANCELED' },
        where: { bookingId: booking.id, status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } },
      });
      await enqueueOutbox(
        tx,
        'booking.checkout_abandoned',
        json({ bookingId: booking.id }),
        `booking.checkout_abandoned:${booking.id}`,
      );
      bookingsExpired += 1;
    });
  }

  const slotHolds = await prisma.slotHold.findMany({
    take: 50,
    where: { expiresAt: { lt: now }, ...(processFrom ? { createdAt: { gte: processFrom } } : {}) },
    select: {
      id: true,
      paymentId: true,
    },
  });
  let slotHoldsExpired = 0;
  for (const hold of slotHolds) {
    if (Date.now() >= deadline) break;
    const payment = hold.paymentId
      ? await prisma.payment.findUnique({ where: { id: hold.paymentId }, select: { id: true, status: true, stripePaymentIntentId: true } })
      : null;
    if (payment?.status === 'PROCESSING' || payment?.status === 'SUCCEEDED') continue;
    const result = await cancelPaymentIntent(payment?.stripePaymentIntentId ?? null);
    if (result === 'skip') continue;
    await prisma.$transaction(async (tx) => {
      if (payment) {
        const canceled = await tx.payment.updateMany({ data: { status: 'CANCELED' }, where: { id: payment.id, status: { in: ['REQUIRES_PAYMENT', 'FAILED', 'CANCELED'] } } });
        if (canceled.count === 0) return;
      }
      const deleted = await tx.slotHold.deleteMany({ where: { expiresAt: { lt: now }, id: hold.id } });
      slotHoldsExpired += deleted.count;
    });
  }

  return { bookingsExpired, slotHoldsExpired };
}
