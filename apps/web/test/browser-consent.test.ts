import { CONSENT_COOKIE_NAME, CONSENT_MAX_AGE_SECONDS } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Consent from '../src/components/consent/consent';
import { cookieInventory } from '../src/content/cookies';

class TestChannel extends EventTarget {
  static peers = new Set<TestChannel>();
  constructor(readonly name: string) {
    super();
    TestChannel.peers.add(this);
  }
  postMessage(data: unknown): void {
    for (const peer of TestChannel.peers) {
      if (peer !== this && peer.name === this.name) peer.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
  close(): void {
    TestChannel.peers.delete(this);
  }
}
let consent: typeof Consent;
let cookie = '';
let lastAssignment = '';
let blocked = false;
let unreadable = false;
const cleanups: Array<() => void> = [];
const savedAt = '2031-03-01T12:00:00.000Z';
function encoded(analytics = true, advertising = false, timestamp = savedAt): string {
  return encodeURIComponent(JSON.stringify({ version: 1, savedAt: timestamp, analytics, advertising }));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(savedAt));
  cookie = '';
  lastAssignment = '';
  blocked = false;
  unreadable = false;
  const document = {
    get cookie(): string {
      if (unreadable) throw new Error('Test cookie access blocked.');
      return cookie;
    },
    set cookie(value: string) {
      lastAssignment = value;
      if (!blocked) cookie = value.split(';')[0] ?? '';
    },
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'https:' } }));
  vi.stubGlobal('BroadcastChannel', TestChannel);
  consent = await import('../src/components/consent/consent');
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
  TestChannel.peers.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('browser consent preferences', () => {
  it('reads only a valid, current versioned consent cookie and restores both saved choices', () => {
    cookie = `unrelated=ignored; ${CONSENT_COOKIE_NAME}=${encoded(true, false)}`;
    expect(consent.readConsent()).toEqual({ version: 1, savedAt, analytics: true, advertising: false });
    vi.setSystemTime(Date.parse(savedAt) + CONSENT_MAX_AGE_SECONDS * 1000);
    expect(consent.readConsent()).toBeNull();
  });

  it.each(['sv_consent=%malformed', 'sv_consent=%7B%22analytics%22%3Atrue%7D', 'unrelated=true'])(
    'denies an invalid or missing cookie: %s',
    (raw) => {
      cookie = raw;
      expect(consent.readConsent()).toBeNull();
    },
  );

  it('treats unavailable browser cookie storage as no consent', () => {
    unreadable = true;
    expect(consent.readConsent()).toBeNull();
    expect(consent.saveConsent({ analytics: true, advertising: true })).toBe(false);
    expect(consent.readConsent()).toBeNull();
  });

  it('persists the documented six-month choice securely and emits one same-tab notification', () => {
    const listener = vi.fn();
    cleanups.push(consent.subscribeToConsentChanges(listener));
    expect(consent.saveConsent({ analytics: true, advertising: false })).toBe(true);
    expect(lastAssignment).toContain(`Max-Age=${String(CONSENT_MAX_AGE_SECONDS)}`);
    expect(lastAssignment).toContain('; Path=/;');
    expect(lastAssignment).toContain('; SameSite=Lax; Secure');
    expect(consent.readConsent()?.analytics).toBe(true);
    expect(consent.readConsent()?.advertising).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies another tab to reread cookies without broadcasting visitor IDs or page information', () => {
    const listener = vi.fn();
    cleanups.push(consent.subscribeToConsentChanges(listener));
    const otherTab = new TestChannel('sv-cookie-preferences');
    cookie = `${CONSENT_COOKIE_NAME}=${encoded(false, false)}`;
    otherTab.postMessage({ type: 'changed', denied: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consent.readConsent()?.analytics).toBe(false);
    otherTab.postMessage({ type: 'other', analytics: true });
    expect(listener).toHaveBeenCalledTimes(1);
    otherTab.close();
  });

  it('fails closed for a blocked opt-in and stops local analytics immediately if withdrawal cannot be persisted', () => {
    blocked = true;
    expect(consent.saveConsent({ analytics: true, advertising: false })).toBe(false);
    expect(consent.readConsent()).toBeNull();
    blocked = false;
    expect(consent.saveConsent({ analytics: true, advertising: true })).toBe(true);
    blocked = true;
    expect(consent.saveConsent({ analytics: false, advertising: false })).toBe(false);
    expect(consent.readConsent()).toEqual({ version: 1, savedAt, analytics: false, advertising: false });
  });

  it('still saves and notifies locally when cross-tab messaging is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const listener = vi.fn();
    cleanups.push(consent.subscribeToConsentChanges(listener));
    expect(consent.saveConsent({ analytics: false, advertising: false })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from local and cross-tab events and closes the shared channel', () => {
    const listener = vi.fn();
    const unsubscribe = consent.subscribeToConsentChanges(listener);
    unsubscribe();
    expect(TestChannel.peers.size).toBe(0);
    consent.saveConsent({ analytics: true, advertising: false });
    expect(listener).not.toHaveBeenCalled();
    expect(TestChannel.peers.size).toBe(0);
  });

  it('discloses the anonymous visitor session cookie in the analytics inventory', () => {
    const visitor = cookieInventory.find((item) => item.name === 'sv_visitor');
    expect(visitor?.category).toBe('analytics');
    expect(visitor?.purpose).toContain('active within the last 90 seconds');
    expect(visitor?.setWhen).toContain('after analytics consent');
    expect(visitor?.setWhen).toContain('session cookie');
  });
});
