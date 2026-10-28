import { CONSENT_COOKIE_NAME, CONSENT_MAX_AGE_SECONDS, parseConsentCookie } from '@sv/contracts';

export type SavedConsent = NonNullable<ReturnType<typeof parseConsentCookie>>;
export type ConsentChoice = Pick<SavedConsent, 'advertising' | 'analytics'>;
export const CONSENT_CHANGE_EVENT = 'sv:consent-change';
const channelName = 'sv-cookie-preferences';
let analyticsDenied = false;
let channel: BroadcastChannel | null = null;
let subscribers = 0;

function preferenceChannel(): BroadcastChannel | null {
  try {
    channel ??= new BroadcastChannel(channelName);
    return channel;
  } catch {
    return null;
  }
}

function storedConsent(): SavedConsent | null {
  try {
    const entry = document.cookie
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${CONSENT_COOKIE_NAME}=`));
    return parseConsentCookie(entry?.slice(CONSENT_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

export function readConsent(): SavedConsent | null {
  const saved = storedConsent();
  return saved && analyticsDenied ? { ...saved, advertising: false, analytics: false } : saved;
}

export function saveConsent(choice: ConsentChoice): boolean {
  const savedAt = new Date().toISOString();
  try {
    const payload = encodeURIComponent(JSON.stringify({ ...choice, version: 1, savedAt }));
    document.cookie = `${CONSENT_COOKIE_NAME}=${payload}; Path=/; Max-Age=${String(CONSENT_MAX_AGE_SECONDS)}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    // Read back below: optional analytics cannot be enabled by a failed write.
  }
  const saved = storedConsent();
  const persisted =
    saved?.savedAt === savedAt &&
    saved.analytics === choice.analytics &&
    saved.advertising === choice.advertising;
  if (persisted) analyticsDenied = false;
  else if (!choice.analytics) analyticsDenied = true;
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
  const broadcast = preferenceChannel();
  try {
    broadcast?.postMessage({ type: 'changed', denied: !choice.analytics });
  } catch {
    // Local listeners already saw the change; other tabs recheck on visibility.
  }
  if (subscribers === 0) {
    broadcast?.close();
    channel = null;
  }
  return persisted;
}

export function subscribeToConsentChanges(listener: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, listener);
  const broadcast = preferenceChannel();
  subscribers += 1;
  function onMessage(event: MessageEvent<unknown>): void {
    const message = event.data;
    if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'changed')
      return;
    if ('denied' in message && message.denied === true) analyticsDenied = true;
    else if (storedConsent()?.analytics) analyticsDenied = false;
    listener();
  }
  broadcast?.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, listener);
    broadcast?.removeEventListener('message', onMessage);
    subscribers -= 1;
    if (subscribers === 0) {
      broadcast?.close();
      channel = null;
    }
  };
}
