import 'server-only';

import { enqueueOutbox, prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import { cancelPaymentIntent } from '../integrations/stripe';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function expireBookingHolds(now = new Date()): Promise<{ bookingsExpired: number; slotHoldsExpired: number }> {
  const bookings = await prisma.booking.findMany({
    take: 50,
    where: { holdExpiresAt: { lt: now }, status: 'PENDING_PAYMENT' },
    select: {
      id: true,
      payments: {
        select: { id: true, kind: true, status: true, stripePaymentIntentId: true },
      },
    },
  });

  let bookingsExpired = 0;
  for (const booking of bookings) {
    // An initial payment awaiting webhook confirmation must keep its booking intact.
    const awaitingConfirmation = booking.payments.some((payment) =>
      (payment.kind === 'BOOKING' || payment.kind === 'ADMIN_BOOKING' || payment.kind === 'MANUAL_QUOTE')
      && (payment.status === 'PROCESSING' || payment.status === 'SUCCEEDED'),
    );
    if (awaitingConfirmation) continue;
    let skip = false;
    for (const payment of booking.payments) {
      if (payment.status !== 'REQUIRES_PAYMENT' && payment.status !== 'FAILED') continue;
      const result = await cancelPaymentIntent(payment.stripePaymentIntentId);
      if (result === 'skip') skip = true;
    }
    if (skip) continue;
    await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        data: { holdExpiresAt: null, status: 'EXPIRED' },
        where: { holdExpiresAt: { lt: now }, id: booking.id, status: 'PENDING_PAYMENT' },
      });
      if (updated.count === 0) return;
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
    where: { expiresAt: { lt: now } },
    select: {
      id: true,
      paymentId: true,
    },
  });
  let slotHoldsExpired = 0;
  for (const hold of slotHolds) {
    const payment = hold.paymentId
      ? await prisma.payment.findUnique({ where: { id: hold.paymentId }, select: { id: true, stripePaymentIntentId: true } })
      : null;
    const result = await cancelPaymentIntent(payment?.stripePaymentIntentId ?? null);
    if (result === 'skip') continue;
    await prisma.$transaction(async (tx) => {
      await tx.slotHold.deleteMany({ where: { expiresAt: { lt: now }, id: hold.id } });
      if (payment) {
        await tx.payment.update({ data: { status: 'CANCELED' }, where: { id: payment.id } });
      }
      slotHoldsExpired += 1;
    });
  }

  return { bookingsExpired, slotHoldsExpired };
}
