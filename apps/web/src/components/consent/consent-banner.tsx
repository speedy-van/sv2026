'use client';

import { useEffect, useState, type ReactNode } from 'react';

const consentCookie = 'sv_consent';
const maxAgeSeconds = 60 * 60 * 24 * 183;

interface ConsentChoice {
  advertising: boolean;
  analytics: boolean;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function hasConsentCookie(): boolean {
  return document.cookie.split(';').some((cookie) => cookie.trim().startsWith(`${consentCookie}=`));
}

function writeConsent(choice: ConsentChoice): void {
  const payload = encodeURIComponent(
    JSON.stringify({
      ...choice,
      version: 1,
      savedAt: new Date().toISOString(),
    }),
  );
  document.cookie = `${consentCookie}=${payload}; Path=/; Max-Age=${String(maxAgeSeconds)}; SameSite=Lax`;
}

function updateGoogleConsent(choice: ConsentChoice): void {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag(...args: unknown[]): void {
      window.dataLayer?.push(args);
    };
  window.gtag('consent', 'update', {
    ad_personalization: choice.advertising ? 'granted' : 'denied',
    ad_storage: choice.advertising ? 'granted' : 'denied',
    ad_user_data: choice.advertising ? 'granted' : 'denied',
    analytics_storage: choice.analytics ? 'granted' : 'denied',
  });
}

export function ConsentBanner(): ReactNode {
  const [visible, setVisible] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice>({ advertising: false, analytics: false });

  useEffect(() => {
    setVisible(!hasConsentCookie());
    const handler = (): void => {
      setChoosing(true);
      setVisible(true);
    };
    const buttons = document.querySelectorAll('[data-open-cookie-settings]');
    buttons.forEach((button) => { button.addEventListener('click', handler); });
    return () => { buttons.forEach((button) => { button.removeEventListener('click', handler); }); };
  }, []);

  function save(next: ConsentChoice): void {
    writeConsent(next);
    updateGoogleConsent(next);
    setVisible(false);
    setChoosing(false);
  }

  return (
    <section aria-label="Cookie preferences" className="consent-banner" hidden={!visible}>
      <div>
        <strong>Cookies</strong>
        <p className="field-help">We use necessary cookies for booking and payments. Analytics and advertising stay off unless you choose them.</p>
      </div>
      {choosing ? (
        <div className="consent-options">
          <label className="toggle-row">
            <span>Analytics cookies</span>
            <input checked={choice.analytics} onChange={(event) => { setChoice((current) => ({ ...current, analytics: event.target.checked })); }} type="checkbox" />
          </label>
          <label className="toggle-row">
            <span>Advertising cookies</span>
            <input checked={choice.advertising} onChange={(event) => { setChoice((current) => ({ ...current, advertising: event.target.checked })); }} type="checkbox" />
          </label>
        </div>
      ) : null}
      <div className="consent-actions">
        <button className="button button-primary" onClick={() => { save({ advertising: true, analytics: true }); }} type="button">
          Accept all
        </button>
        <button className="button button-secondary" onClick={() => { save({ advertising: false, analytics: false }); }} type="button">
          Reject all
        </button>
        {choosing ? (
          <button className="button button-brand" onClick={() => { save(choice); }} type="button">
            Save
          </button>
        ) : (
          <button className="button button-ghost" onClick={() => { setChoosing(true); }} type="button">
            Choose
          </button>
        )}
      </div>
    </section>
  );
}
