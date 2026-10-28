import type { PaymentIntent } from '@stripe/stripe-js';
import { paymentCopy } from '@/content/payments';

export interface CustomerPaymentResult {
  state: 'paid' | 'pending' | 'canceled' | 'incomplete';
  message: string;
}

export function customerPaymentResult(status: PaymentIntent['status'] | undefined): CustomerPaymentResult {
  switch (status) {
    case 'succeeded':
      return { state: 'paid', message: paymentCopy.received };
    case 'processing':
      return { state: 'pending', message: paymentCopy.processing };
    case 'requires_capture':
      return { state: 'pending', message: paymentCopy.awaitingConfirmation };
    case 'canceled':
      return { state: 'canceled', message: paymentCopy.canceled };
    default:
      return { state: 'incomplete', message: paymentCopy.incomplete };
  }
}
