import 'server-only';

import { AppError } from '@sv/contracts';
import Stripe from 'stripe';
import { serverEnv } from '../env';

export interface PaymentIntentTarget {
  amountPence: number;
  booking: {
    contactEmail: string;
    reference: string;
  };
  bookingId: string;
  currency: string;
  id: string;
  kind: string;
  stripePaymentIntentId: string | null;
}

export interface RefundTarget {
  amountPence: number;
  bookingId: string;
  id: string;
  payment: {
    stripePaymentIntentId: string | null;
  };
}

let client: Stripe | null | undefined;

function mockAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.E2E === '1';
}

function stripeClient(): Stripe | null {
  if (client !== undefined) return client;
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) {
    if (mockAllowed()) {
      client = null;
      return client;
    }
    throw new AppError('INTERNAL', 'STRIPE_SECRET_KEY is required.');
  }
  client = new Stripe(key, { maxNetworkRetries: 2, timeout: 10_000 });
  return client;
}

function mockIntent(payment: PaymentIntentTarget): { clientSecret: string; id: string } {
  return {
    clientSecret: `pi_mock_${payment.id}_secret_mock`,
    id: `pi_mock_${payment.id}`,
  };
}

function stripeError(error: unknown): AppError {
  if (error instanceof Stripe.errors.StripeCardError) {
    return new AppError('PAYMENT_FAILED', error.message, { stripeCode: error.code });
  }
  if (error instanceof Stripe.errors.StripeError) {
    return new AppError('UPSTREAM_UNAVAILABLE', 'Stripe is temporarily unavailable.', { stripeType: error.type });
  }
  return new AppError('UPSTREAM_UNAVAILABLE', 'Stripe is temporarily unavailable.');
}

export async function createOrRetrievePaymentIntent(payment: PaymentIntentTarget): Promise<{ clientSecret: string; id: string }> {
  const stripe = stripeClient();
  if (!stripe) return mockIntent(payment);

  try {
    if (payment.stripePaymentIntentId) {
      const existing = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
      if (!existing.client_secret) throw new AppError('PAYMENT_FAILED', 'Payment could not be resumed.');
      return { clientSecret: existing.client_secret, id: existing.id };
    }

    const created = await stripe.paymentIntents.create(
      {
        amount: payment.amountPence,
        automatic_payment_methods: { enabled: true },
        currency: payment.currency,
        description: `Speedy Van ${payment.booking.reference} - ${payment.kind}`,
        metadata: {
          bookingId: payment.bookingId,
          kind: payment.kind,
          paymentId: payment.id,
        },
        statement_descriptor_suffix: payment.booking.reference.replace('-', '').slice(0, 22),
      },
      { idempotencyKey: `pi_${payment.id}` },
    );
    if (!created.client_secret) throw new AppError('PAYMENT_FAILED', 'Payment could not be started.');
    return { clientSecret: created.client_secret, id: created.id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw stripeError(error);
  }
}

export async function cancelPaymentIntent(paymentIntentId: string | null): Promise<'canceled' | 'skip'> {
  if (!paymentIntentId) return 'canceled';
  if (paymentIntentId.startsWith('pi_mock_')) return 'canceled';
  const stripe = stripeClient();
  if (!stripe) return 'canceled';
  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntentId);
    if (canceled.status === 'succeeded' || canceled.status === 'processing') return 'skip';
    return 'canceled';
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.message.includes('already')) return 'skip';
    throw stripeError(error);
  }
}

export async function createStripeRefund(refund: RefundTarget): Promise<{ id: string; status: 'PENDING' | 'SUCCEEDED' }> {
  const paymentIntent = refund.payment.stripePaymentIntentId;
  if (!paymentIntent || paymentIntent.startsWith('pi_mock_')) {
    return { id: `re_mock_${refund.id}`, status: 'SUCCEEDED' };
  }
  const stripe = stripeClient();
  if (!stripe) return { id: `re_mock_${refund.id}`, status: 'SUCCEEDED' };
  try {
    const created = await stripe.refunds.create(
      {
        amount: refund.amountPence,
        metadata: { bookingId: refund.bookingId, refundId: refund.id },
        payment_intent: paymentIntent,
        reason: 'requested_by_customer',
      },
      { idempotencyKey: `re_${refund.id}` },
    );
    return { id: created.id, status: created.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING' };
  } catch (error) {
    throw stripeError(error);
  }
}

export function constructStripeEvent(body: string, signature: string | null): Stripe.Event {
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  const stripe = stripeClient();
  if (secret && stripe) {
    if (!signature) throw new AppError('VALIDATION_ERROR', 'Missing Stripe signature.');
    try {
      return stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid Stripe signature.');
    }
  }
  if (!mockAllowed()) throw new AppError('INTERNAL', 'STRIPE_WEBHOOK_SECRET is required.');
  return JSON.parse(body) as Stripe.Event;
}
