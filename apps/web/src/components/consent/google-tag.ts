'use client';

import { captureMessage } from '@sentry/nextjs';
import { googleTagConfig } from '@/lib/google-tag-config';
import { readConsent, type ConsentChoice } from './consent';

type GoogleParams = Record<string, unknown>;
export type GoogleDestination = 'analytics' | 'advertising';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const denied: ConsentChoice = { advertising: false, analytics: false };
const configured = new Set<string>();
let initialized = false;
let lastConsent = '';
let lastPageView = '';

function consentSignals(choice: ConsentChoice): Record<string, string> {
  return {
    ad_personalization: choice.advertising ? 'granted' : 'denied',
    ad_storage: choice.advertising ? 'granted' : 'denied',
    ad_user_data: choice.advertising ? 'granted' : 'denied',
    analytics_storage: choice.analytics ? 'granted' : 'denied',
  };
}

/** Queries/fragments and customer-specific path segments never enter Google events. */
export function sanitizedGoogleUrl(raw: string, referrer = false): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (referrer) return url.origin;
    const privatePath = /^\/(manage|pay|track|review|quote)(?:\/|$)/u.exec(url.pathname);
    const path = privatePath ? `/${privatePath[1] ?? ''}` : url.pathname;
    const clean = new URL(`${url.origin}${path}`);
    if (!privatePath) {
      for (const name of ['gclid', 'dclid', 'gbraid', 'wbraid']) {
        const value = url.searchParams.get(name);
        if (value && /^[A-Za-z0-9._~-]{1,512}$/u.test(value)) clean.searchParams.set(name, value);
      }
    }
    return clean.href;
  } catch {
    // Unparseable page metadata is deliberately omitted, never sent verbatim.
    return '';
  }
}

export function googlePageContext(): GoogleParams {
  return {
    page_location: sanitizedGoogleUrl(window.location.href),
    page_referrer: sanitizedGoogleUrl(document.referrer, true),
    page_title: 'Speedy Van',
  };
}

/** Initializes the local queue only; the React loader performs the consent-gated network load. */
function synchronize(): string | null {
  if (typeof window === 'undefined') return null;
  const config = googleTagConfig();
  if (!config.analyticsId && !config.adsId) return null;
  // The root layout's beforeInteractive script supplies Google's official Arguments queue.
  // If blocked, fail closed; an incomplete queue must not consume a purchase marker.
  const tag = window.gtag;
  if (!tag) return null;
  // Customer self-service pages have no acquisition events and must not load/configure tags.
  const privatePage = /^\/(manage|pay|track|review|quote)(?:\/|$)/u.test(window.location.pathname);
  const choice = privatePage ? denied : (readConsent() ?? denied);
  if (config.analyticsId) window[`ga-disable-${config.analyticsId}`] = !choice.analytics;
  if (!initialized) {
    tag('consent', 'default', consentSignals(denied));
    tag('set', { ads_data_redaction: true, url_passthrough: false, send_page_view: false });
    initialized = true;
  }
  // Consent updates can cause requests from a previously loaded provider, even on withdrawal.
  tag('set', googlePageContext());
  const consentKey = `${String(choice.analytics)}:${String(choice.advertising)}`;
  if (consentKey !== lastConsent) {
    tag('consent', 'update', consentSignals(choice));
    lastConsent = consentKey;
  }
  const destinations = [
    ...(choice.analytics && config.analyticsId ? [config.analyticsId] : []),
    ...(choice.advertising && config.adsId ? [config.adsId] : []),
  ];
  if (destinations.length === 0) return null;
  if (configured.size === 0) tag('js', new Date());
  for (const id of destinations) {
    if (configured.has(id)) continue;
    tag('config', id, {
      ...googlePageContext(),
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      allow_enhanced_conversions: false,
    });
    configured.add(id);
  }
  return destinations[0] ?? null;
}

export function synchronizeGoogleTag(): string | null {
  try {
    return synchronize();
  } catch {
    captureMessage('Google tag could not be initialized.', 'warning');
    return null;
  }
}

/** True means accepted by the local Google queue, not delivery/attribution confirmation. */
export function sendGoogleEvent(
  destination: GoogleDestination,
  event: string,
  params: GoogleParams,
): boolean {
  const config = googleTagConfig();
  const choice = readConsent() ?? denied;
  const id = destination === 'analytics' ? config.analyticsId : config.adsId;
  if (!id || !choice[destination] || (destination === 'advertising' && !config.purchaseLabel)) return false;
  try {
    if (!synchronizeGoogleTag() || !window.gtag) return false;
    window.gtag('event', event, {
      ...params,
      ...googlePageContext(),
      send_to: destination === 'analytics' ? id : `${id}/${config.purchaseLabel}`,
    });
    return true;
  } catch {
    // Analytics must not interrupt a booking or consume its retry/dedup marker.
    captureMessage('Google event could not be queued.', 'warning');
    return false;
  }
}

export function trackGooglePageView(): void {
  const config = googleTagConfig();
  if (!config.analyticsId || !readConsent()?.analytics || typeof window === 'undefined') return;
  const page = sanitizedGoogleUrl(window.location.href);
  if (!page || page === lastPageView) return;
  if (sendGoogleEvent('analytics', 'page_view', {})) lastPageView = page;
}
