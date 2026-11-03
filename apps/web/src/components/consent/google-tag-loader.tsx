'use client';

import { captureMessage } from '@sentry/nextjs';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { subscribeToConsentChanges } from './consent';
import { synchronizeGoogleTag, trackGooglePageView } from './google-tag';

export function GoogleTagLoader(): ReactNode {
  const pathname = usePathname();
  const [loaderId, setLoaderId] = useState<string | null>(null);
  useEffect(() => {
    function synchronize(): void {
      try {
        setLoaderId(synchronizeGoogleTag());
        trackGooglePageView();
      } catch {
        setLoaderId(null);
        captureMessage('Google tag synchronization failed.', 'warning');
      }
    }
    synchronize();
    const unsubscribe = subscribeToConsentChanges(synchronize);
    return unsubscribe;
  }, [pathname]);
  if (!loaderId) return null;
  return (
    <Script
      id="sv-google-tag"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(loaderId)}`}
      strategy="afterInteractive"
      onError={() => {
        captureMessage('Google tag script failed to load.', 'warning');
      }}
    />
  );
}
