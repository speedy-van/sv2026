'use client';

type BookingEvent =
  | 'add_payment_info'
  | 'address_selected'
  | 'begin_checkout'
  | 'booking_start'
  | 'manual_quote_shown'
  | 'payment_failed'
  | 'purchase'
  | 'quote_requested'
  | 'quote_shown'
  | 'slot_selected';

type EventParams = Record<string, boolean | number | string | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const consentCookie = 'sv_consent';
const ga4Id = process.env.NEXT_PUBLIC_GA4_ID ?? '';
const googleAdsId = process.env.NEXT_PUBLIC_GADS_ID ?? '';
const googleAdsPurchaseLabel = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL ?? '';

function consent(): { advertising: boolean; analytics: boolean } {
  if (typeof document === 'undefined') return { advertising: false, analytics: false };
  const raw = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${consentCookie}=`))
    ?.slice(consentCookie.length + 1);
  if (!raw) return { advertising: false, analytics: false };
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { advertising?: unknown; analytics?: unknown };
    return { advertising: parsed.advertising === true, analytics: parsed.analytics === true };
  } catch {
    return { advertising: false, analytics: false };
  }
}

function gtag(...args: unknown[]): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  window.gtag(...args);
}

function definedParams(params: EventParams): EventParams {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function trackBookingEvent(event: BookingEvent, params: EventParams = {}): void {
  if (!ga4Id || !consent().analytics) return;
  gtag('event', event, definedParams(params));
}

export function trackBookingStart(params: EventParams = {}): void {
  if (typeof sessionStorage === 'undefined') return;
  const key = 'sv_booking_start_tracked';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  trackBookingEvent('booking_start', { page_type: 'booking', ...params });
}

export function trackPurchase(params: { reference: string; service?: string; totalPence: number }): void {
  const key = `sv_purchase_tracked_${params.reference}`;
  if (typeof sessionStorage !== 'undefined') {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  }
  const value = params.totalPence / 100;
  trackBookingEvent('purchase', {
    currency: 'GBP',
    item_id: params.service,
    transaction_id: params.reference,
    value,
  });
  if (!googleAdsId || !googleAdsPurchaseLabel || !consent().advertising) return;
  gtag('event', 'conversion', {
    currency: 'GBP',
    send_to: `${googleAdsId}/${googleAdsPurchaseLabel}`,
    transaction_id: params.reference,
    value,
  });
}

export function distanceBand(distanceMiles: number): string {
  if (distanceMiles <= 5) return '0-5';
  if (distanceMiles <= 20) return '5-20';
  if (distanceMiles <= 50) return '20-50';
  return '50+';
}
