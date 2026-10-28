import { describe, expect, it } from 'vitest';
import { customerPaymentResult } from '../src/components/customer/payment-result';
import { paymentCopy } from '../src/content/payments';

describe('customer payment confirmation status', () => {
  it('recognizes only a succeeded intent as paid', () => {
    expect(customerPaymentResult('succeeded')).toEqual({ state: 'paid', message: paymentCopy.received });
  });

  it.each(['processing', 'requires_capture'] as const)('keeps %s pending without allowing a second payment', (status) => {
    const result = customerPaymentResult(status);
    expect(result.state).toBe('pending');
    expect(result.message).toContain('Do not pay again.');
    expect(result.message).not.toContain('Payment received');
  });

  it.each(['requires_payment_method', 'requires_confirmation', 'requires_action', undefined] as const)(
    'keeps unfinished intent %s retryable rather than marking it paid',
    (status) => {
      expect(customerPaymentResult(status)).toEqual({ state: 'incomplete', message: paymentCopy.incomplete });
    },
  );

  it('offers contact recovery for a canceled intent instead of reporting payment received', () => {
    expect(customerPaymentResult('canceled')).toEqual({ state: 'canceled', message: paymentCopy.canceled });
  });
});
