'use client';

import { useEffect } from 'react';
import { readConsent, subscribeToConsentChanges } from './consent';
import { startVisitorPresence } from './visitor-presence';
import { currentBookingActivity, subscribeBookingActivity } from '../booking-flow/activity';

export function VisitorPresenceTracker(): null {
  useEffect(() => {
    const browser: Partial<Navigator> = navigator;
    function subscribe(target: EventTarget, event: string, listener: () => void): () => void {
      target.addEventListener(event, listener);
      return () => {
        target.removeEventListener(event, listener);
      };
    }
    const environment = {
      fetch: window.fetch.bind(window),
      ...(browser.locks ? { locks: browser.locks } : {}),
      readConsent,
      isVisible: () => document.visibilityState === 'visible',
      subscribeConsent: subscribeToConsentChanges,
      subscribeVisibility: (listener: () => void) => subscribe(document, 'visibilitychange', listener),
      subscribeOnline: (listener: () => void) => subscribe(window, 'online', listener),
    };
    const stopPresence = startVisitorPresence(environment);
    // Keep the withdrawal listener alive on other pages after leaving /book.
    const stopActivity = startVisitorPresence({ ...environment,
      isVisible: () => document.visibilityState === 'visible' && navigator.onLine && currentBookingActivity() !== null,
      subscribeVisibility: (listener) => {
        const stopVisible = environment.subscribeVisibility(listener);
        const stopStage = subscribeBookingActivity(listener);
        return () => { stopVisible(); stopStage(); };
      },
    }, { endpoint: '/api/v1/bookings/activity', lockName: 'sv-booking-activity', body: currentBookingActivity, withdrawOnStartWithoutConsent: true, retryWithdrawal: true, settleInFlightWhenHidden: true });
    return () => { stopPresence(); stopActivity(); };
  }, []);
  return null;
}
