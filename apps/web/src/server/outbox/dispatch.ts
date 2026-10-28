import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { prisma } from '@sv/db';
import { processOutboxBatch } from './processor';
import { maintainPushReceipts } from '../notifications/receipt-maintenance';

// Only this payment's durable events and their channel jobs are eligible. Other
// bookings and historical pending work are never drained by a customer request.
export async function dispatchPendingOutbox(paymentIntentId: string): Promise<void> {
  const deadline = Date.now() + 40_000;
  let paymentFound = false;
  try {
    const payment = await prisma.payment.findFirst({
      where: {
        stripePaymentIntentId: paymentIntentId,
        status: 'SUCCEEDED',
        booking: { deletedAt: null },
      },
      select: { id: true, bookingId: true, kind: true },
    });
    if (!payment) return;
    paymentFound = true;
    let claims = 0;
    const drain = async (rootEventId: string): Promise<void> => {
      while (claims < 12 && Date.now() < deadline) {
        claims += 1;
        const result = await processOutboxBatch(
          1,
          ['booking.confirmed', 'booking.rescheduled', 'booking.extra_paid', 'payment.refund',
            'payment.refund.created', 'payment.after_expiry_refunded', 'notification.create', 'push.send', 'email.send'],
          { rootEventId },
        );
        if (result.done + result.failed === 0) return;
      }
    };

    const refunds = await prisma.refund.findMany({
      where: { paymentId: payment.id },
      select: { id: true },
      take: 20,
    });
    // Late/failed-capacity refunds run before their customer status email. Each
    // root is derived from a refund belonging to this exact succeeded payment.
    if (refunds.length > 0) {
      const refundEvents = await prisma.outboxEvent.findMany({
        where: {
          type: 'payment.refund',
          dedupeKey: { in: refunds.flatMap((refund) => [
            `late-payment-refund:${refund.id}`, `expired-reschedule-refund:${refund.id}`, `taken-reschedule-refund:${refund.id}`,
          ]) },
        },
        select: { id: true },
        take: 20,
      });
      for (const event of refundEvents) await drain(event.id);
    }

    const paymentEvent = payment.kind === 'RESCHEDULE_DIFFERENCE'
      ? { dedupeKey: `booking.rescheduled:${payment.id}`, type: 'booking.rescheduled' }
      : payment.kind === 'EXTRA_CHARGE'
        ? { dedupeKey: `booking.extra_paid:${payment.id}`, type: 'booking.extra_paid' }
        : { dedupeKey: `booking.confirmed:${payment.bookingId}`, type: 'booking.confirmed' };
    const events = await prisma.outboxEvent.findMany({
      where: { OR: [
        paymentEvent,
        { dedupeKey: `payment.after_expiry_refunded:${payment.id}`, type: 'payment.after_expiry_refunded' },
        ...refunds.map((refund) => ({ dedupeKey: `payment.refund.created:${refund.id}`, type: 'payment.refund.created' })),
      ] },
      select: { id: true },
      take: 25,
    });
    for (const event of events) await drain(event.id);
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'webhook-outbox-dispatch' } });
  } finally {
    // Delivery stays first; unknown/unpaid requests do not trigger maintenance.
    if (paymentFound && Date.now() < deadline) await maintainPushReceipts();
  }
}
