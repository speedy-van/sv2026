'use client';

import { captureMessage } from '@sentry/nextjs';
import { subscribeToConsentChanges } from '../consent/consent';
import { sendGoogleEvent } from '../consent/google-tag';
import { googleTagConfig } from '@/lib/google-tag-config';
import { isStripeTestMode } from '@/lib/payment-mode';

type BookingEvent =
  | 'add_payment_info'
  | 'address_selected'
  | 'begin_checkout'
  | 'booking_start'
  | 'manual_quote_shown'
  | 'payment_failed'
  | 'quote_requested'
  | 'quote_shown'
  | 'slot_selected';

type EventParams = Record<string, boolean | number | string | undefined>;

const queuedEvents = new Set<string>();

function definedParams(params: EventParams): EventParams {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function trackBookingEvent(event: BookingEvent, params: EventParams = {}): void {
  sendGoogleEvent('analytics', event, definedParams(params));
}

function onceQueued(key: string, send: () => boolean, persist = false): void {
  if (queuedEvents.has(key)) return;
  try {
    if (persist && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return;
  } catch {
    // Storage restrictions cannot block booking; retain in-memory + Google transaction deduplication.
    captureMessage('Google event deduplication storage is unavailable.', 'warning');
  }
  if (!send()) return;
  queuedEvents.add(key);
  try {
    if (persist && typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1');
  } catch {
    captureMessage('Google event deduplication could not be persisted.', 'warning');
  }
}

export function trackBookingStart(params: EventParams = {}): void {
  const { analyticsId } = googleTagConfig();
  if (!analyticsId) return;
  onceQueued(
    `sv_booking_start_${analyticsId}`,
    () => sendGoogleEvent('analytics', 'booking_start', { page_type: 'booking', ...definedParams(params) }),
    true,
  );
}

interface PurchaseParams {
  reference: string;
  service?: string;
  status: string;
  totalPence: number;
}

/** Checks this build's payment environment, not the mode of a historical booking. */
function hasLivePaymentConfiguration(): boolean {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (isStripeTestMode(publishableKey)) return false;
  // An absent test prefix is not proof of live mode. Unknown configuration fails closed.
  return /^pk_live_[A-Za-z0-9]+$/u.test(publishableKey ?? '');
}

export function trackPurchase(params: PurchaseParams): void {
  if (
    !hasLivePaymentConfiguration() ||
    params.status !== 'CONFIRMED' ||
    !/^[A-Za-z0-9-]{1,64}$/u.test(params.reference) ||
    !Number.isSafeInteger(params.totalPence) ||
    params.totalPence <= 0
  )
    return;
  const { analyticsId, adsId, purchaseLabel } = googleTagConfig();
  // Queue acceptance is not delivery. Keep purchase deduplication in page memory only;
  // a reload retries with the same transaction_id for Google's destination-side deduplication.
  const value = params.totalPence / 100;
  const purchase = {
    currency: 'GBP',
    transaction_id: params.reference,
    value,
    ...(params.service ? { items: [{ item_id: params.service, price: value, quantity: 1 }] } : {}),
  };
  if (analyticsId)
    onceQueued(`sv_purchase_${analyticsId}_${params.reference}`, () =>
      sendGoogleEvent('analytics', 'purchase', purchase),
    );
  if (adsId && purchaseLabel)
    onceQueued(`sv_purchase_${adsId}_${purchaseLabel}_${params.reference}`, () =>
      sendGoogleEvent('advertising', 'conversion', {
        currency: 'GBP',
        transaction_id: params.reference,
        value,
      }),
    );
}

/** Retains only the currently mounted confirmed booking; never replays an old browsing history. */
export function subscribeConfirmedPurchase(params: PurchaseParams): () => void {
  if (params.status !== 'CONFIRMED' || !hasLivePaymentConfiguration()) return () => undefined;
  const retry = (): void => {
    trackPurchase(params);
  };
  retry();
  return subscribeToConsentChanges(retry);
}

export function distanceBand(distanceMiles: number): string {
  if (distanceMiles <= 5) return '0-5';
  if (distanceMiles <= 20) return '5-20';
  if (distanceMiles <= 50) return '20-50';
  return '50+';
}
