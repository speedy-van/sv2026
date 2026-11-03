'use client';

import { useEffect } from 'react';
import { readConsent, subscribeToConsentChanges } from './consent';
import { startVisitorPresence } from './visitor-presence';

export function VisitorPresenceTracker(): null {
  useEffect(() => {
    const browser: Partial<Navigator> = navigator;
    function subscribe(target: EventTarget, event: string, listener: () => void): () => void {
      target.addEventListener(event, listener);
      return () => {
        target.removeEventListener(event, listener);
      };
    }
    return startVisitorPresence({
      fetch: window.fetch.bind(window),
      ...(browser.locks ? { locks: browser.locks } : {}),
      readConsent,
      isVisible: () => document.visibilityState === 'visible',
      subscribeConsent: subscribeToConsentChanges,
      subscribeVisibility: (listener) => subscribe(document, 'visibilitychange', listener),
      subscribeOnline: (listener) => subscribe(window, 'online', listener),
    });
  }, []);
  return null;
}
