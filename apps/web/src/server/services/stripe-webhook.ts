import 'server-only';

import { AppError } from '@sv/contracts';
import { assertSlotCapacity, enqueueOutbox, prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import type Stripe from 'stripe';
import { requestRefund, recomputeBookingMoney } from './payments';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function paymentIntentId(intent: Stripe.PaymentIntent): string {
  return intent.id;
}

function metadataPaymentId(intent: Stripe.PaymentIntent): string | undefined {
  const value = intent.metadata.paymentId;
  return value && value.length > 0 ? value : undefined;
}

async function findPayment(intent: Stripe.PaymentIntent) {
  const or: Prisma.PaymentWhereInput[] = [{ stripePaymentIntentId: paymentIntentId(intent) }];
  const metadataId = metadataPaymentId(intent);
  if (metadataId) or.push({ id: metadataId });
  return prisma.payment.findFirst({
    where: {
      OR: or,
    },
    select: {
      amountPence: true,
      booking: {
        select: {
          blocksSlots: true,
          capacityUnits: true,
          holdExpiresAt: true,
          id: true,
          moveDate: true,
          quoteId: true,
          slot: true,
          status: true,
        },
      },
      bookingId: true,
      id: true,
      kind: true,
      status: true,
    },
  });
}

async function confirmBookingPayment(paymentId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        amountPence: true,
        booking: {
          select: {
            blocksSlots: true,
            capacityUnits: true,
            holdExpiresAt: true,
            id: true,
            moveDate: true,
            quoteId: true,
            slot: true,
            status: true,
          },
        },
        bookingId: true,
        id: true,
        kind: true,
        status: true,
      },
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.');
    if (payment.status === 'SUCCEEDED' && payment.booking.status === 'CONFIRMED') return;

    const holdExpired = !payment.booking.holdExpiresAt || payment.booking.holdExpiresAt.getTime() <= now.getTime() || payment.booking.status === 'EXPIRED';
    if (holdExpired) {
      try {
        await assertSlotCapacity(tx, {
          blocksSlots: payment.booking.blocksSlots,
          capacityUnits: payment.booking.capacityUnits,
          moveDate: payment.booking.moveDate,
          now,
          slot: payment.booking.slot,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'SLOT_UNAVAILABLE') throw error;
        await tx.payment.update({ data: { status: 'SUCCEEDED' }, where: { id: payment.id } });
        await tx.booking.update({
          data: { holdExpiresAt: null, status: 'EXPIRED' },
          where: { id: payment.bookingId },
        });
        await recomputeBookingMoney(tx, payment.bookingId);
        await requestRefund(tx, payment.bookingId, payment.amountPence, 'Paid after the booking hold expired.', {
          dedupePrefix: 'late-payment-refund',
          notifyCustomer: false,
        });
        await enqueueOutbox(
          tx,
          'payment.after_expiry_refunded',
          json({ bookingId: payment.bookingId, paymentId: payment.id }),
          `payment.after_expiry_refunded:${payment.id}`,
        );
        return;
      }
    }

    await tx.payment.update({ data: { status: 'SUCCEEDED' }, where: { id: payment.id } });
    await tx.booking.update({
      data: { holdExpiresAt: null, status: 'CONFIRMED' },
      where: { id: payment.bookingId },
    });
    await recomputeBookingMoney(tx, payment.bookingId);
    if (payment.booking.quoteId) {
      await tx.quote.update({ data: { status: 'CONVERTED' }, where: { id: payment.booking.quoteId } });
      await tx.manualQuote.updateMany({
        data: { bookingId: payment.bookingId, status: 'ACCEPTED' },
        where: { quoteId: payment.booking.quoteId },
      });
    }
    await enqueueOutbox(tx, 'booking.confirmed', json({ bookingId: payment.bookingId }), `booking.confirmed:${payment.bookingId}`);
  });
}

async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent, now: Date): Promise<void> {
  const payment = await findPayment(intent);
  if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.');
  const amountReceived = typeof intent.amount_received === 'number' ? intent.amount_received : intent.amount;
  if (amountReceived !== payment.amountPence || intent.currency !== 'gbp') {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        data: {
          failureCode: 'amount_mismatch',
          failureMessage: `Stripe reported ${String(amountReceived)} ${intent.currency}.`,
          stripePaymentIntentId: intent.id,
        },
        where: { id: payment.id },
      });
      await enqueueOutbox(
        tx,
        'system.alert',
        json({ bookingId: payment.bookingId, issue: 'Stripe amount mismatch', paymentId: payment.id }),
        `system.alert:payment-mismatch:${payment.id}`,
      );
    });
    return;
  }
  await prisma.payment.update({
    data: {
      status: 'SUCCEEDED',
      stripeChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id ?? null,
      stripePaymentIntentId: intent.id,
    },
    where: { id: payment.id },
  });
  if (payment.kind === 'BOOKING' || payment.kind === 'ADMIN_BOOKING' || payment.kind === 'MANUAL_QUOTE') {
    await confirmBookingPayment(payment.id, now);
  } else {
    await prisma.$transaction(async (tx) => {
      await recomputeBookingMoney(tx, payment.bookingId);
    });
  }
}

async function handlePaymentIntentStatus(intent: Stripe.PaymentIntent, status: 'PROCESSING' | 'REQUIRES_PAYMENT' | 'CANCELED'): Promise<void> {
  const payment = await findPayment(intent);
  if (!payment) return;
  await prisma.payment.update({
    data: {
      failureCode: intent.last_payment_error?.code ?? null,
      failureMessage: intent.last_payment_error?.message ?? null,
      status,
      stripePaymentIntentId: intent.id,
    },
    where: { id: payment.id },
  });
}

async function handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
  const metadataRefundId = refund.metadata?.refundId;
  const status = refund.status === 'succeeded' ? 'SUCCEEDED' : refund.status === 'canceled' ? 'CANCELED' : refund.status === 'failed' ? 'FAILED' : 'PENDING';
  await prisma.$transaction(async (tx) => {
    const row = metadataRefundId
      ? await tx.refund.findUnique({ where: { id: metadataRefundId }, select: { id: true, payment: { select: { bookingId: true } } } })
      : await tx.refund.findUnique({ where: { stripeRefundId: refund.id }, select: { id: true, payment: { select: { bookingId: true } } } });
    if (!row) return;
    await tx.refund.update({ data: { status, stripeRefundId: refund.id }, where: { id: row.id } });
    await recomputeBookingMoney(tx, row.payment.bookingId);
  });
}

async function handleDispute(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  await prisma.$transaction(async (tx) => {
    await enqueueOutbox(
      tx,
      event.type === 'charge.dispute.created' ? 'payment.dispute.created' : 'payment.dispute.closed',
      json({ disputeId: dispute.id, paymentIntentId: typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null }),
      `${event.type}:${dispute.id}`,
    );
  });
}

export async function handleStripeEvent(event: Stripe.Event, now = new Date()): Promise<'processed' | 'replay'> {
  const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id }, select: { processedAt: true } });
  if (existing?.processedAt) return 'replay';
  if (!existing) {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      await handlePaymentIntentSucceeded(event.data.object, now);
    } else if (event.type === 'payment_intent.processing') {
      await handlePaymentIntentStatus(event.data.object, 'PROCESSING');
    } else if (event.type === 'payment_intent.payment_failed') {
      await handlePaymentIntentStatus(event.data.object, 'REQUIRES_PAYMENT');
    } else if (event.type === 'payment_intent.canceled') {
      await handlePaymentIntentStatus(event.data.object, 'CANCELED');
    } else if (event.type === 'refund.updated') {
      await handleRefundUpdated(event.data.object);
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const refunds = charge.refunds && typeof charge.refunds === 'object' ? charge.refunds.data : [];
      for (const refund of refunds) await handleRefundUpdated(refund);
    } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      await handleDispute(event);
    }
    await prisma.stripeEvent.update({ data: { error: null, processedAt: new Date() }, where: { id: event.id } });
    return 'processed';
  } catch (error) {
    await prisma.stripeEvent.update({
      data: { error: error instanceof Error ? error.message : 'Unknown webhook error' },
      where: { id: event.id },
    });
    throw error;
  }
}
