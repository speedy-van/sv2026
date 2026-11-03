export function isStripeTestMode(publishableKey: string | undefined): boolean {
  return publishableKey?.startsWith('pk_test_') ?? false;
}

export const stripeTestMode = isStripeTestMode(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
