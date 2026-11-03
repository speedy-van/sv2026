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

export interface CleanupPaymentIdentity { bookingId: string; paymentId: string }

/** Resolve old test checkouts explicitly; a missing live object alone never proves cancellation. */
async function cleanupIntent(stripe: Stripe, paymentIntentId: string, identity: CleanupPaymentIdentity | undefined): Promise<{ stripe: Stripe; intent: Stripe.PaymentIntent }> {
  try {
    return { stripe, intent: await stripe.paymentIntents.retrieve(paymentIntentId) };
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== 'resource_missing') throw error;
    const legacyKey = serverEnv().STRIPE_LEGACY_TEST_SECRET_KEY;
    const unavailable = (): AppError => new AppError('CONFLICT', 'This payment belongs to a different Stripe account or mode and must be reconciled before deleting this job.');
    if (!identity || !legacyKey?.startsWith('sk_test_')) throw unavailable();
    const legacy = new Stripe(legacyKey, { maxNetworkRetries: 1, timeout: 10_000 });
    let intent: Stripe.PaymentIntent;
    try {
      intent = await legacy.paymentIntents.retrieve(paymentIntentId);
    } catch (legacyError) {
      if (legacyError instanceof Stripe.errors.StripeInvalidRequestError && legacyError.code === 'resource_missing') throw unavailable();
      throw legacyError;
    }
    if (intent.livemode || intent.metadata.bookingId !== identity.bookingId || intent.metadata.paymentId !== identity.paymentId) {
      throw new AppError('CONFLICT', 'The historical payment could not be matched to this booking. Nothing was deleted.');
    }
    return { stripe: legacy, intent };
  }
}

/** Cleanup must prove cancellation; a missing client or an ambiguous Stripe response is not success. */
export async function cancelPaymentIntentForCleanup(paymentIntentId: string, identity?: CleanupPaymentIdentity): Promise<void> {
  if (paymentIntentId.startsWith('pi_mock_')) {
    const testMode = process.env.NODE_ENV === 'test' || (process.env.NODE_ENV === 'development' && process.env.E2E === '1');
    if (testMode) return;
    throw new AppError('CONFLICT', 'This payment must be checked before removing the booking.');
  }
  const configuredStripe = stripeClient();
  if (!configuredStripe) throw new AppError('UPSTREAM_UNAVAILABLE', 'Payment cancellation is unavailable. Please try again later.');
  const assertUnpaid = (intent: Stripe.PaymentIntent): void => {
    if (intent.status === 'processing' || intent.status === 'succeeded' || intent.status === 'requires_capture'
      || intent.amount_received > 0 || intent.amount_capturable > 0) {
      throw new AppError('CONFLICT', 'A payment is processing or has received funds. Refresh this booking before removing it.');
    }
  };
  try {
    const { stripe, intent: current } = await cleanupIntent(configuredStripe, paymentIntentId, identity);
    assertUnpaid(current);
    if (current.status === 'canceled') return;
    try {
      const canceled = await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `cleanup_cancel_${paymentIntentId}` });
      assertUnpaid(canceled);
      if (canceled.status !== 'canceled') throw new AppError('CONFLICT', 'Payment cancellation could not be confirmed. Refresh this booking.');
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
      // Another request may have canceled or confirmed the intent after the first retrieve.
      const latest = await stripe.paymentIntents.retrieve(paymentIntentId);
      assertUnpaid(latest);
      if (latest.status !== 'canceled') throw error;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
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
