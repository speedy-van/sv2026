import type { BookingStatusResponseSchema } from '@sv/contracts';
import type { z } from 'zod';

export type BookingStatusResponse = z.infer<typeof BookingStatusResponseSchema>;
export type ConfirmationState =
  | 'checking'
  | 'pending'
  | 'failed'
  | 'canceled'
  | 'processing'
  | 'received'
  | 'expired'
  | 'unavailable'
  | 'error'
  | 'missing'
  | 'confirmed';

export const confirmationPollIntervalMs = 1500;
export const confirmationPollDurationMs = 30_000;

export function confirmationState({
  data,
  redirectStatus,
  timedOut,
}: {
  data: BookingStatusResponse;
  redirectStatus: string | null;
  timedOut: boolean;
}): ConfirmationState {
  if (data.status === 'CONFIRMED') return 'confirmed';
  if (data.status !== 'PENDING_PAYMENT') {
    if (
      data.status === 'EXPIRED' &&
      data.checkout?.paymentStatus !== 'SUCCEEDED' &&
      data.checkout?.paymentStatus !== 'PROCESSING'
    )
      return 'expired';
    return 'unavailable';
  }
  // Only the server's payment record can establish receipt or processing.
  // A redirect query parameter can describe a failed attempt, never prove success.
  const checkout = data.checkout;
  if (checkout?.paymentStatus === 'SUCCEEDED') return 'received';
  if (checkout?.paymentStatus === 'PROCESSING') return 'processing';
  if (checkout?.paymentStatus === 'CANCELED') return 'canceled';
  if (checkout?.holdExpiresAt && Date.parse(checkout.holdExpiresAt) <= Date.now()) return 'expired';
  if (checkout?.paymentStatus === 'FAILED' || redirectStatus === 'failed') return 'failed';
  if (redirectStatus === 'canceled' || redirectStatus === 'cancelled') return 'canceled';
  return timedOut ? 'pending' : 'checking';
}

export function shouldPollConfirmation(data: BookingStatusResponse | undefined, timedOut: boolean): boolean {
  if (timedOut) return false;
  if (!data) return true;
  if (data.status !== 'PENDING_PAYMENT') return false;
  return data.checkout?.paymentStatus !== 'CANCELED';
}

export function canRefreshCheckout(data: BookingStatusResponse): boolean {
  const payment = data.checkout?.paymentStatus;
  if (payment === 'SUCCEEDED' || payment === 'PROCESSING') return false;
  // A browser clock cannot establish that Stripe has canceled an older intent.
  return data.status === 'EXPIRED' || (data.status === 'PENDING_PAYMENT' && payment === 'CANCELED');
}
