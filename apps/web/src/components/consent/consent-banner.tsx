'use client';

import { CONSENT_MAX_AGE_SECONDS } from '@sv/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readConsent, saveConsent, subscribeToConsentChanges, type ConsentChoice } from './consent';
import { consentSaveError } from '@/content/cookies';

const rejected: ConsentChoice = { advertising: false, analytics: false };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
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
  const [visible, setVisible] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice>(rejected);
  const [error, setError] = useState<string | null>(null);
  const preferencesOpen = useRef(false);

  useEffect(() => {
    let expiration: ReturnType<typeof setTimeout> | undefined;
    function synchronize(): void {
      const saved = readConsent();
      if (!preferencesOpen.current) {
        setChoice(saved ?? rejected);
        setVisible(!saved);
      }
      updateGoogleConsent(saved ?? rejected);
      clearTimeout(expiration);
      if (saved) {
        const remaining = Date.parse(saved.savedAt) + CONSENT_MAX_AGE_SECONDS * 1000 - Date.now();
        expiration = setTimeout(synchronize, Math.min(Math.max(remaining, 1), 2_147_483_647));
      }
    }
    function settings(): void {
      preferencesOpen.current = true;
      setChoice(readConsent() ?? rejected);
      setError(null);
      setChoosing(true);
      setVisible(true);
    }
    function externalChange(): void {
      preferencesOpen.current = false;
      setChoosing(false);
      synchronize();
    }
    function onVisible(): void {
      if (document.visibilityState === 'visible') synchronize();
    }
    synchronize();
    const unsubscribe = subscribeToConsentChanges(externalChange);
    document.addEventListener('visibilitychange', onVisible);
    const buttons = document.querySelectorAll('[data-open-cookie-settings]');
    buttons.forEach((button) => {
      button.addEventListener('click', settings);
    });
    return () => {
      unsubscribe();
      clearTimeout(expiration);
      document.removeEventListener('visibilitychange', onVisible);
      buttons.forEach((button) => {
        button.removeEventListener('click', settings);
      });
    };
  }, []);

  function save(next: ConsentChoice): void {
    const saved = saveConsent(next);
    updateGoogleConsent(readConsent() ?? rejected);
    setError(saved ? null : consentSaveError);
    setVisible(!saved);
    setChoosing(false);
    preferencesOpen.current = false;
  }

  return (
    <section aria-label="Cookie preferences" className="consent-banner" hidden={!visible}>
      <div>
        <strong>Cookies</strong>
        <p className="field-help">
          We use necessary cookies for booking and payments. Analytics and advertising stay off unless you
          choose them.
        </p>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {choosing ? (
        <div className="consent-options">
          <label className="toggle-row">
            <span>Analytics cookies</span>
            <input
              checked={choice.analytics}
              onChange={(event) => {
                setChoice((current) => ({ ...current, analytics: event.target.checked }));
              }}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>Advertising cookies</span>
            <input
              checked={choice.advertising}
              onChange={(event) => {
                setChoice((current) => ({ ...current, advertising: event.target.checked }));
              }}
              type="checkbox"
            />
          </label>
        </div>
      ) : null}
      <div className="consent-actions">
        <button
          className="button button-primary"
          onClick={() => {
            save({ advertising: true, analytics: true });
          }}
          type="button"
        >
          Accept all
        </button>
        <button
          className="button button-secondary"
          onClick={() => {
            save(rejected);
          }}
          type="button"
        >
          Reject all
        </button>
        {choosing ? (
          <button
            className="button button-brand"
            onClick={() => {
              save(choice);
            }}
            type="button"
          >
            Save
          </button>
        ) : (
          <button
            className="button button-ghost"
            onClick={() => {
              preferencesOpen.current = true;
              setChoice(readConsent() ?? rejected);
              setError(null);
              setChoosing(true);
            }}
            type="button"
          >
            Choose
          </button>
        )}
      </div>
    </section>
  );
}
