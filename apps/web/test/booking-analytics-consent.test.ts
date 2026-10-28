import { CONSENT_CLOCK_SKEW_SECONDS, CONSENT_MAX_AGE_SECONDS } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Analytics from '../src/components/booking-flow/analytics';

let analytics: typeof Analytics;
let cookie = '';
const now = Date.parse('2031-03-01T12:00:00.000Z');
const gtag = vi.fn();
function setConsent(choice: { analytics: boolean; advertising: boolean }, savedAt = now, version = 1): void {
  cookie = `sv_consent=${encodeURIComponent(JSON.stringify({ ...choice, version, savedAt: new Date(savedAt).toISOString() }))}`;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  cookie = '';
  gtag.mockReset();
  vi.stubEnv('NEXT_PUBLIC_GA4_ID', 'G-UNIT-TEST');
  vi.stubEnv('NEXT_PUBLIC_GADS_ID', 'AW-UNIT-TEST');
  vi.stubEnv('NEXT_PUBLIC_GADS_PURCHASE_LABEL', 'unit-test');
  vi.stubGlobal('window', { gtag });
  vi.stubGlobal('document', {
    get cookie() {
      return cookie;
    },
  });
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  analytics = await import('../src/components/booking-flow/analytics');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('booking events use current shared consent validity', () => {
  it('preserves an opted-in analytics event and its defined parameters', () => {
    setConsent({ analytics: true, advertising: false });
    analytics.trackBookingEvent('quote_shown', { crew: 2, omitted: undefined });
    expect(gtag).toHaveBeenCalledWith('event', 'quote_shown', { crew: 2 });
  });

  it.each(['missing', 'expired', 'future', 'old-version'] as const)(
    'does not send analytics for a %s choice',
    (kind) => {
      if (kind === 'expired')
        setConsent({ analytics: true, advertising: true }, now - CONSENT_MAX_AGE_SECONDS * 1000);
      if (kind === 'future') setConsent({ analytics: true, advertising: true }, now + CONSENT_CLOCK_SKEW_SECONDS * 1000 + 1);
      if (kind === 'old-version') setConsent({ analytics: true, advertising: true }, now, 2);
      analytics.trackBookingEvent('booking_start');
      analytics.trackPurchase({ reference: 'SV-CONSENT-TEST', totalPence: 10000 });
      expect(gtag).not.toHaveBeenCalled();
    },
  );

  it('does not treat advertising permission as analytics permission', () => {
    setConsent({ analytics: false, advertising: true });
    analytics.trackBookingEvent('quote_shown');
    expect(gtag).not.toHaveBeenCalled();
    analytics.trackPurchase({ reference: 'SV-ADS-TEST', totalPence: 10000 });
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      currency: 'GBP',
      send_to: 'AW-UNIT-TEST/unit-test',
      transaction_id: 'SV-ADS-TEST',
      value: 100,
    });
  });

  it('preserves analytics-only purchase consent and transaction deduplication', () => {
    setConsent({ analytics: true, advertising: false });
    const purchase = { reference: 'SV-ANALYTICS-TEST', service: 'furniture', totalPence: 12345 };
    analytics.trackPurchase(purchase);
    analytics.trackPurchase(purchase);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', {
      currency: 'GBP',
      item_id: 'furniture',
      transaction_id: 'SV-ANALYTICS-TEST',
      value: 123.45,
    });
  });

  it('denies analytics when cookie access is unavailable instead of throwing', () => {
    vi.stubGlobal('document', {
      get cookie(): never {
        throw new Error('Test storage blocked.');
      },
    });
    expect(() => {
      analytics.trackBookingEvent('quote_shown');
    }).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
  });
});
