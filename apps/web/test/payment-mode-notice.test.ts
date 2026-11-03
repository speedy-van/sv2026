import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStripeTestMode } from '../src/lib/payment-mode';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('public payment-mode disclosure', () => {
  it.each([
    ['pk_test_fixture', true],
    ['pk_live_fixture', false],
    ['', false],
    [undefined, false],
    ['sk_test_not_a_public_key', false],
  ] as const)('recognizes only public test-mode keys (%s)', (key, expected) => {
    expect(isStripeTestMode(key)).toBe(expected);
  });

  it('recognizes configured test payments even when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_fixture');
    vi.resetModules();
    const { stripeTestMode } = await import('../src/lib/payment-mode');
    expect(stripeTestMode).toBe(true);
  });

  it('does not show a test-mode claim when the public key is live', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_fixture');
    vi.resetModules();
    const { stripeTestMode } = await import('../src/lib/payment-mode');
    expect(stripeTestMode).toBe(false);
  });
});
