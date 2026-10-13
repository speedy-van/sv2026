import { AppError } from '@sv/contracts';
import { prisma } from '@sv/db';
import type Stripe from 'stripe';
import { apiJson, withApi } from '@/server/request';
import { verifyBookingStatusToken } from '@/server/status-token';
import { handleStripeEvent } from '@/server/services/stripe-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ request, requestId }) => {
    if (process.env.NODE_ENV === 'production' && process.env.E2E !== '1') {
      throw new AppError('FORBIDDEN', 'Test payment hook is disabled.');
    }
    const body = await request.json() as { clientSecret?: string; paymentId?: string; token?: string };
    const paymentIntentId = body.clientSecret?.split('_secret_')[0];
    const token = body.token ? verifyBookingStatusToken(body.token) : null;
    const payment = await prisma.payment.findFirst({
      where: body.paymentId
        ? { id: body.paymentId }
        : paymentIntentId
          ? { OR: [{ stripePaymentIntentId: paymentIntentId }, { id: paymentIntentId.replace(/^pi_mock_/, '') }] }
          : token
            ? { bookingId: token.bookingId, kind: 'BOOKING' }
            : { id: '__missing__' },
      select: { amountPence: true, bookingId: true, id: true, stripePaymentIntentId: true },
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.');
    const intent = {
      amount: payment.amountPence,
      amount_received: payment.amountPence,
      currency: 'gbp',
      id: payment.stripePaymentIntentId ?? `pi_mock_${payment.id}`,
      latest_charge: 'ch_mock_booking_flow',
      metadata: { bookingId: payment.bookingId, paymentId: payment.id },
      object: 'payment_intent',
    } as unknown as Stripe.PaymentIntent;
    await handleStripeEvent({
      data: {
        object: intent,
      },
      id: `evt_test_${payment.id}`,
      object: 'event',
      type: 'payment_intent.succeeded',
    } as Stripe.Event);
    return apiJson({ ok: true }, {}, requestId);
  });
}
