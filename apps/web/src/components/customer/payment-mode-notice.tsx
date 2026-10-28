import type { ReactNode } from 'react';
import { paymentCopy } from '@/content/payments';
import { stripeTestMode } from '@/lib/payment-mode';

export function PaymentModeNotice(): ReactNode {
  if (!stripeTestMode) return null;
  return (
    <div className="booking-alert booking-alert-warning" role="note">
      <span><strong>{paymentCopy.testModeTitle}.</strong> {paymentCopy.testModeMessage}</span>
    </div>
  );
}
