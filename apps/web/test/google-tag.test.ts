import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { GOOGLE_TAG_BOOTSTRAP } from '../src/components/consent/google-tag-bootstrap';
import type * as Tag from '../src/components/consent/google-tag';
import type * as Analytics from '../src/components/booking-flow/analytics';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
let tag: typeof Tag;
let analytics: typeof Analytics;
let cookie = '';
const gtag = vi.fn<(...args: unknown[]) => void>();
const storage = new Map<string, string>();
const purchase = { reference: 'SV-TEST123', status: 'CONFIRMED', totalPence: 12345, service: 'house' };

function consent(analyticsAllowed: boolean, advertising: boolean): void {
  cookie = `sv_consent=${encodeURIComponent(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), analytics: analyticsAllowed, advertising }))}`;
  window.dispatchEvent(new Event('sv:consent-change'));
}
function events(name: string): unknown[][] {
  return gtag.mock.calls.filter(([command, event]) => command === 'event' && event === name);
}

beforeEach(async () => {
  vi.resetModules();
  gtag.mockReset();
  storage.clear();
  cookie = '';
  vi.stubEnv('NEXT_PUBLIC_GA4_ID', 'G-TEST123');
  vi.stubEnv('NEXT_PUBLIC_GADS_ID', 'AW-123456789');
  vi.stubEnv('NEXT_PUBLIC_GADS_PURCHASE_LABEL', 'test_label');
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_fixture');
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      gtag,
      location: new URL(
        'https://www.speedyvan.uk/book/confirmation?t=private-token&payment_intent_client_secret=private-secret',
      ),
    }),
  );
  vi.stubGlobal('document', {
    get cookie() {
      return cookie;
    },
    referrer: 'https://www.speedyvan.uk/manage/receipt?token=private-referrer',
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('BroadcastChannel', undefined);
  tag = await import('../src/components/consent/google-tag');
  analytics = await import('../src/components/booking-flow/analytics');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Google tag initialization and privacy', () => {
  it('returns no loader/config for missing consent and orders denied defaults before any config', () => {
    expect(tag.synchronizeGoogleTag()).toBeNull();
    expect(gtag.mock.calls.some(([command]) => command === 'config')).toBe(false);
    consent(true, true);
    expect(tag.synchronizeGoogleTag()).toBe('G-TEST123');
    expect(gtag.mock.calls[0]).toEqual([
      'consent',
      'default',
      {
        ad_personalization: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        analytics_storage: 'denied',
      },
    ]);
    expect(gtag).toHaveBeenCalledWith(
      'config',
      'G-TEST123',
      expect.objectContaining({ send_page_view: false }),
    );
    expect(gtag).toHaveBeenCalledWith(
      'config',
      'AW-123456789',
      expect.objectContaining({
        page_location: 'https://www.speedyvan.uk/book/confirmation',
        page_referrer: 'https://www.speedyvan.uk',
      }),
    );
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('private-');
  });

  it('does not initialize an absent or malformed destination', () => {
    vi.stubEnv('NEXT_PUBLIC_GA4_ID', '');
    vi.stubEnv('NEXT_PUBLIC_GADS_ID', 'AW-not-an-id');
    consent(true, true);
    expect(tag.synchronizeGoogleTag()).toBeNull();
    analytics.trackPurchase(purchase);
    expect(gtag).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it('does not consume a purchase retry when the local bootstrap is unavailable', () => {
    consent(true, true);
    delete window.gtag;
    expect(tag.synchronizeGoogleTag()).toBeNull();
    analytics.trackPurchase(purchase);
    expect(storage.size).toBe(0);
    window.gtag = gtag;
    analytics.trackPurchase(purchase);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(1);
  });

  it('uses the official Arguments command queue rather than array dataLayer messages', () => {
    delete window.gtag;
    runInNewContext(GOOGLE_TAG_BOOTSTRAP, { window });
    tag.synchronizeGoogleTag();
    expect(Object.prototype.toString.call(window.dataLayer?.[0])).toBe('[object Arguments]');
  });

  it('configures only the consented destination and disables GA4 after withdrawal', () => {
    consent(true, false);
    tag.synchronizeGoogleTag();
    expect(gtag.mock.calls.filter(([c]) => c === 'config').map((c) => c[1])).toEqual(['G-TEST123']);
    consent(false, false);
    expect(tag.synchronizeGoogleTag()).toBeNull();
    expect(window['ga-disable-G-TEST123']).toBe(true);
    analytics.trackPurchase(purchase);
    expect(events('purchase')).toHaveLength(0);
    expect(events('conversion')).toHaveLength(0);
  });

  it.each(['/manage', '/pay', '/track/private-token', '/review/private-token', '/quote/private-id'])(
    'does not configure or send events on private page %s even after earlier consent',
    (path) => {
      consent(true, true);
      tag.synchronizeGoogleTag();
      window.location.href = `https://www.speedyvan.uk${path}?t=secret`;
      gtag.mockClear();
      expect(tag.synchronizeGoogleTag()).toBeNull();
      const updateIndex = gtag.mock.calls.findIndex(
        ([command, action]) => command === 'consent' && action === 'update',
      );
      expect(updateIndex).toBeGreaterThan(0);
      expect(gtag.mock.calls[updateIndex - 1]).toEqual([
        'set',
        expect.objectContaining({
          page_location: `https://www.speedyvan.uk/${path.split('/')[1] ?? ''}`,
        }),
      ]);
      expect(tag.sendGoogleEvent('advertising', 'conversion', {})).toBe(false);
      expect(gtag.mock.calls.some(([command]) => command === 'event' || command === 'config')).toBe(false);
      expect(window['ga-disable-G-TEST123']).toBe(true);
    },
  );

  it('preserves click attribution only through a narrow query allowlist', () => {
    expect(
      tag.sanitizedGoogleUrl(
        'https://www.speedyvan.uk/?gclid=abc_123&t=secret&email=name@example.com#private',
      ),
    ).toBe('https://www.speedyvan.uk/?gclid=abc_123');
    expect(tag.sanitizedGoogleUrl('https://www.speedyvan.uk/track/private-token?gclid=abc&t=secret')).toBe(
      'https://www.speedyvan.uk/track',
    );
    expect(tag.sanitizedGoogleUrl('https://www.speedyvan.uk/review/private-token?token=x', true)).toBe(
      'https://www.speedyvan.uk',
    );
    expect(tag.sanitizedGoogleUrl('javascript:alert(1)')).toBe('');
  });

  it('contains provider initialization failures without interrupting confirmation or consuming purchase retries', () => {
    consent(true, true);
    gtag.mockImplementation(() => {
      throw new Error('Provider unavailable');
    });
    expect(tag.synchronizeGoogleTag()).toBeNull();
    expect(() => {
      analytics.trackPurchase(purchase);
    }).not.toThrow();
    gtag.mockImplementation(() => undefined);
    analytics.trackPurchase(purchase);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(1);
  });
});

describe('confirmed purchase delivery', () => {
  it.each([
    'pk_test_fixture',
    undefined,
    '',
    'pk_live_',
    'pk_live_fixture-invalid',
    'sk_live_not_a_public_key',
  ])('does not queue purchases in a test or unknown payment environment (%s)', (publishableKey) => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', publishableKey);
    consent(true, true);
    analytics.trackPurchase(purchase);
    const stop = analytics.subscribeConfirmedPurchase(purchase);
    consent(true, true);
    stop();
    expect(gtag).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it('does not consume transaction deduplication while payment mode is unknown', () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
    consent(true, true);
    analytics.trackPurchase(purchase);
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_fixture');
    analytics.trackPurchase(purchase);
    analytics.trackPurchase(purchase);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(1);
  });

  it('uses the GA4 item structure without changing direct Ads conversion fields', () => {
    consent(true, true);
    analytics.trackPurchase(purchase);
    const ga4Params = events('purchase')[0]?.[2];
    expect(ga4Params).toEqual(
      expect.objectContaining({
        currency: 'GBP',
        transaction_id: purchase.reference,
        value: 123.45,
        items: [{ item_id: 'house', price: 123.45, quantity: 1 }],
      }),
    );
    expect(ga4Params).not.toHaveProperty('item_id');
    expect(events('conversion')[0]?.[2]).toEqual(
      expect.objectContaining({
        currency: 'GBP',
        transaction_id: purchase.reference,
        value: 123.45,
        send_to: 'AW-123456789/test_label',
      }),
    );
    expect(events('conversion')[0]?.[2]).not.toHaveProperty('items');
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('private-');
  });

  it('retains purchase value without inventing an item when the service is unavailable', () => {
    consent(true, true);
    analytics.trackPurchase({ reference: purchase.reference, status: 'CONFIRMED', totalPence: 12345 });
    expect(events('purchase')[0]?.[2]).toEqual(
      expect.objectContaining({ transaction_id: purchase.reference, currency: 'GBP', value: 123.45 }),
    );
    expect(events('purchase')[0]?.[2]).not.toHaveProperty('items');
  });

  it('recovers a mounted confirmed purchase on late consent and deduplicates per destination', () => {
    const stop = analytics.subscribeConfirmedPurchase(purchase);
    expect(storage.size).toBe(0);
    consent(true, false);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(0);
    consent(true, true);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(1);
    expect(events('purchase')[0]?.[2]).toEqual(
      expect.objectContaining({ send_to: 'G-TEST123', value: 123.45, currency: 'GBP' }),
    );
    expect(events('conversion')[0]?.[2]).toEqual(
      expect.objectContaining({ send_to: 'AW-123456789/test_label', transaction_id: 'SV-TEST123' }),
    );
    stop();
    consent(true, true);
    expect(events('conversion')).toHaveLength(1);
  });

  it('does not replay a booking after its confirmation component unmounts', () => {
    const stop = analytics.subscribeConfirmedPurchase(purchase);
    stop();
    consent(true, true);
    expect(events('purchase')).toHaveLength(0);
    expect(events('conversion')).toHaveLength(0);
  });

  it.each(['PENDING_PAYMENT', 'CANCELED', 'EXPIRED', 'FAILED'])(
    'does not count %s as a completed booking',
    (status) => {
      consent(true, true);
      analytics.trackPurchase({ ...purchase, status });
      expect(gtag).not.toHaveBeenCalled();
      expect(storage.size).toBe(0);
    },
  );

  it.each([0, -1, Number.NaN, 1.1])(
    'does not invent a conversion value for invalid total %s',
    (totalPence) => {
      consent(true, true);
      analytics.trackPurchase({ ...purchase, totalPence });
      expect(events('purchase')).toHaveLength(0);
    },
  );

  it('keeps failed dispatch eligible and suppresses only the successfully queued destination', () => {
    consent(true, true);
    gtag.mockImplementation((command, event) => {
      if (command === 'event' && event === 'conversion') throw new Error('Test queue failure');
    });
    analytics.trackPurchase(purchase);
    expect(storage.size).toBe(0);
    gtag.mockImplementation(() => undefined);
    analytics.trackPurchase(purchase);
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(2);
    expect(storage.size).toBe(0);
  });

  it('retries with the same transaction ID after reload when the Google script never loaded', async () => {
    consent(true, true);
    delete window.gtag;
    runInNewContext(GOOGLE_TAG_BOOTSTRAP, { window });
    analytics.trackPurchase(purchase);
    expect(storage.size).toBe(0);
    expect(window.dataLayer?.length).toBeGreaterThan(0);
    // A new document loses the undelivered queue; sessionStorage survives the reload.
    vi.resetModules();
    window.gtag = gtag;
    window.dataLayer = [];
    const reloaded = await import('../src/components/booking-flow/analytics');
    reloaded.trackPurchase(purchase);
    expect(events('purchase')[0]?.[2]).toEqual(
      expect.objectContaining({ transaction_id: purchase.reference }),
    );
    expect(events('conversion')[0]?.[2]).toEqual(
      expect.objectContaining({ transaction_id: purchase.reference }),
    );
    expect(storage.size).toBe(0);
  });

  it('survives blocked storage and keeps in-memory transaction deduplication', () => {
    consent(true, true);
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    expect(() => {
      analytics.trackPurchase(purchase);
      analytics.trackPurchase(purchase);
    }).not.toThrow();
    expect(events('purchase')).toHaveLength(1);
    expect(events('conversion')).toHaveLength(1);
  });

  it('does not consume the booking-start marker before consent', () => {
    analytics.trackBookingStart();
    expect(storage.size).toBe(0);
    consent(true, false);
    analytics.trackBookingStart();
    analytics.trackBookingStart();
    expect(events('booking_start')).toHaveLength(1);
  });
});

describe('conditional Google Ads CSP', () => {
  it('adds the documented Ads hosts only with a valid configured Ads ID', async () => {
    const configured = (await import('../next.config')).default;
    const configuredHeaders = await configured.headers?.();
    const policy =
      configuredHeaders?.[0]?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(policy).toContain('https://www.googleadservices.com');
    expect(policy).toContain('https://www.google.co.uk');
    expect(policy).toContain('https://ad.doubleclick.net');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_GADS_ID', '');
    const disabled = (await import('../next.config')).default;
    const disabledHeaders = await disabled.headers?.();
    const disabledPolicy =
      disabledHeaders?.[0]?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(disabledPolicy).not.toContain('googleadservices.com');
    expect(disabledPolicy).not.toContain('doubleclick.net');
    expect(disabledPolicy).toContain('https://js.stripe.com');
  });
});
