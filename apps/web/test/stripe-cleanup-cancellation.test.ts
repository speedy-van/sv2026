import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StripeMocks { retrieve: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; legacyRetrieve: ReturnType<typeof vi.fn>; legacyCancel: ReturnType<typeof vi.fn>; key: string | undefined; legacyKey: string | undefined }
const mocks = vi.hoisted<StripeMocks>(() => ({ retrieve: vi.fn(), cancel: vi.fn(), legacyRetrieve: vi.fn(), legacyCancel: vi.fn(), key: 'unit-test-key', legacyKey: undefined }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ STRIPE_SECRET_KEY: mocks.key, STRIPE_LEGACY_TEST_SECRET_KEY: mocks.legacyKey }) }));
vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Stripe }>();
  class MockStripe {
    static errors = actual.default.errors;
    paymentIntents: { retrieve: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
    constructor(key: string) {
      this.paymentIntents = key === mocks.legacyKey ? { retrieve: mocks.legacyRetrieve, cancel: mocks.legacyCancel } : { retrieve: mocks.retrieve, cancel: mocks.cancel };
    }
  }
  return { default: MockStripe };
});

function intent(status: Stripe.PaymentIntent.Status, overrides: { amount_received?: number; amount_capturable?: number } = {}) {
  return { id: 'pi_unit', status, amount_received: 0, amount_capturable: 0, ...overrides };
}
async function cleanup() {
  const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
  return cancelPaymentIntentForCleanup('pi_unit');
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.key = 'unit-test-key';
  mocks.legacyKey = undefined;
  mocks.retrieve.mockResolvedValue(intent('requires_payment_method'));
  mocks.cancel.mockResolvedValue(intent('canceled'));
});
afterEach(() => vi.unstubAllEnvs());

describe('strict Stripe cancellation for admin cleanup without network calls', () => {
  const identity = { bookingId: 'booking-unit', paymentId: 'payment-unit' };
  const missing = (): Stripe.errors.StripeInvalidRequestError => new Stripe.errors.StripeInvalidRequestError({ message: 'No such payment intent.', code: 'resource_missing' });
  const historical = (overrides: Record<string, unknown> = {}) => ({ ...intent('requires_payment_method'), livemode: false, metadata: identity, ...overrides });

  it('proves identity and cancels an old unpaid test checkout with its own test account', async () => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(missing());
    mocks.legacyRetrieve.mockResolvedValue(historical());
    mocks.legacyCancel.mockResolvedValue({ ...historical(), status: 'canceled' });
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await cancelPaymentIntentForCleanup('pi_unit', identity);
    expect(mocks.legacyRetrieve).toHaveBeenCalledExactlyOnceWith('pi_unit');
    expect(mocks.legacyCancel).toHaveBeenCalledExactlyOnceWith('pi_unit', {}, { idempotencyKey: 'cleanup_cancel_pi_unit' });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each([{}, { bookingId: 'different', paymentId: identity.paymentId }, { bookingId: identity.bookingId, paymentId: 'different' }])('rejects a historical payment with mismatched metadata %#', async (metadata) => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(missing());
    mocks.legacyRetrieve.mockResolvedValue(historical({ metadata }));
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.legacyCancel).not.toHaveBeenCalled();
  });

  it.each([{ livemode: true }, { status: 'succeeded' }, { status: 'processing' }, { amount_received: 1 }, { amount_capturable: 1 }])('rejects live, processing or funded historical payments %#', async (overrides) => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(missing());
    mocks.legacyRetrieve.mockResolvedValue(historical(overrides));
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.legacyCancel).not.toHaveBeenCalled();
  });

  it('never equates resource_missing in both accounts with successful cancellation', async () => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(missing());
    mocks.legacyRetrieve.mockRejectedValue(missing());
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.legacyCancel).not.toHaveBeenCalled();
  });

  it('fails closed if the legacy key or expected identity is missing', async () => {
    mocks.retrieve.mockRejectedValue(missing());
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.legacyKey = 'sk_test_unit';
    await expect(cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.legacyRetrieve).not.toHaveBeenCalled();
  });

  it('does not try the historical account after a transport or auth error', async () => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(new Error('Network unavailable'));
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(mocks.legacyRetrieve).not.toHaveBeenCalled();
  });

  it('refuses a live key in the historical test-key slot', async () => {
    mocks.legacyKey = 'sk_live_refused';
    mocks.retrieve.mockRejectedValue(missing());
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.legacyRetrieve).not.toHaveBeenCalled();
  });

  it('rejects a historical payment that receives funds during cancellation', async () => {
    mocks.legacyKey = 'sk_test_unit';
    mocks.retrieve.mockRejectedValue(missing());
    mocks.legacyRetrieve.mockResolvedValueOnce(historical()).mockResolvedValueOnce(historical({ status: 'succeeded', amount_received: 1 }));
    mocks.legacyCancel.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({ message: 'State changed' }));
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_unit', identity)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('retrieves and proves cancellation with a stable request idempotency key', async () => {
    await cleanup();
    expect(mocks.retrieve).toHaveBeenCalledExactlyOnceWith('pi_unit');
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('pi_unit', {}, { idempotencyKey: 'cleanup_cancel_pi_unit' });
  });

  it('accepts an already canceled intent without trying to cancel it again', async () => {
    mocks.retrieve.mockResolvedValue(intent('canceled'));
    await cleanup();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(['processing', 'succeeded', 'requires_capture'] as const)('rejects %s before cancellation', async (status) => {
    mocks.retrieve.mockResolvedValue(intent(status));
    await expect(cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each([{ amount_received: 1 }, { amount_capturable: 1 }])('protects received or authorized funds %#', async (amount) => {
    mocks.retrieve.mockResolvedValue(intent('requires_payment_method', amount));
    await expect(cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('fails closed when the cancellation response is not canceled', async () => {
    mocks.cancel.mockResolvedValue(intent('requires_action'));
    await expect(cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rechecks an already-canceled race using the returned status rather than error text', async () => {
    mocks.cancel.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({ message: 'The intent is already canceled.' }));
    mocks.retrieve.mockResolvedValueOnce(intent('requires_payment_method')).mockResolvedValueOnce(intent('canceled'));
    await cleanup();
    expect(mocks.retrieve).toHaveBeenCalledTimes(2);
  });

  it('rejects a payment that succeeded between retrieve and cancellation', async () => {
    mocks.cancel.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({ message: 'The intent state changed.' }));
    mocks.retrieve.mockResolvedValueOnce(intent('requires_payment_method')).mockResolvedValueOnce(intent('succeeded'));
    await expect(cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a network failure to a retryable error without claiming cancellation', async () => {
    mocks.cancel.mockRejectedValue(new Error('Unit-test upstream outage'));
    await expect(cleanup()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('fails closed for a real intent when Stripe is not configured', async () => {
    mocks.key = undefined;
    await expect(cleanup()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('permits mock IDs only in explicit non-production test mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('E2E', '1');
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await cancelPaymentIntentForCleanup('pi_mock_unit');
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it.each([['development', '0'], ['production', '1']] as const)('refuses mock IDs in %s with E2E=%s', async (mode, e2e) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('E2E', e2e);
    const { cancelPaymentIntentForCleanup } = await import('../src/server/integrations/stripe');
    await expect(cancelPaymentIntentForCleanup('pi_mock_unit')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
});
