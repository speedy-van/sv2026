import { describe, expect, it } from 'vitest';
import {
  AdminVisitorPresenceResponseSchema, CONSENT_CLOCK_SKEW_SECONDS, CONSENT_MAX_AGE_SECONDS, parseConsentCookie,
  VISITOR_ACTIVE_WINDOW_SECONDS, VISITOR_HEARTBEAT_INTERVAL_SECONDS,
  VisitorPresenceHeartbeatRequestSchema, VisitorPresenceHeartbeatResponseSchema,
} from '../src';

const now = Date.parse('2031-03-01T12:00:00.000Z');
const consent = { analytics: true, advertising: false, version: 1, savedAt: new Date(now - 1000).toISOString() };
const encode = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

describe('shared consent and anonymous visitor presence contracts', () => {
  it('reads existing encoded consent only when its booleans, version and age are valid', () => {
    expect(parseConsentCookie(encode(consent), now)).toEqual(consent);
    expect(parseConsentCookie(encode({ ...consent, analytics: false }), now)?.analytics).toBe(false);
    expect(parseConsentCookie(encode({ ...consent, savedAt: new Date(now).toISOString() }), now)).toMatchObject({ analytics: true });
  });

  it('accepts a fresh explicit choice when the browser clock is at most 60 seconds ahead', () => {
    expect(parseConsentCookie(encode({ ...consent, savedAt: new Date(now + 1500).toISOString() }), now))
      .toMatchObject({ analytics: true });
    expect(parseConsentCookie(encode({ ...consent, analytics: false, savedAt: new Date(now + CONSENT_CLOCK_SKEW_SECONDS * 1000).toISOString() }), now))
      .toMatchObject({ analytics: false });
  });

  it.each([
    undefined, '', '%broken', 'not-json', 'null', encode({}),
    encode({ ...consent, version: 2 }), encode({ ...consent, analytics: 'true' }),
    encode({ ...consent, advertising: null }), encode({ ...consent, extra: true }),
    encode({ ...consent, savedAt: '2031-03-01' }), encode({ ...consent, savedAt: new Date(now + CONSENT_CLOCK_SKEW_SECONDS * 1000 + 1).toISOString() }),
    encode({ ...consent, savedAt: new Date(now - CONSENT_MAX_AGE_SECONDS * 1000).toISOString() }),
  ])('rejects malformed, future, expired or unsupported consent %#', (raw) => {
    expect(parseConsentCookie(raw, now)).toBeNull();
  });

  it('accepts no client-provided identity, path, time or other heartbeat data', () => {
    expect(VisitorPresenceHeartbeatRequestSchema.parse({})).toEqual({});
    for (const data of [{ id: 'client-chosen' }, { lastSeenAt: new Date(now).toISOString() }, { path: '/book' }]) {
      expect(VisitorPresenceHeartbeatRequestSchema.safeParse(data).success).toBe(false);
    }
    expect(VISITOR_HEARTBEAT_INTERVAL_SECONDS).toBe(30);
    expect(VISITOR_ACTIVE_WINDOW_SECONDS).toBe(90);
    expect(VisitorPresenceHeartbeatResponseSchema.parse({ activeWindowSeconds: 90 })).toEqual({ activeWindowSeconds: 90 });
  });

  it('returns only an honest consenting-browser count with a server timestamp and fixed active window', () => {
    const value = { activeVisitors: 0, generatedAt: new Date(now).toISOString(), activeWindowSeconds: 90, measurement: 'consenting-browsers' };
    expect(AdminVisitorPresenceResponseSchema.parse(value)).toEqual(value);
    expect(AdminVisitorPresenceResponseSchema.safeParse({ ...value, activeVisitors: -1 }).success).toBe(false);
    expect(AdminVisitorPresenceResponseSchema.safeParse({ ...value, measurement: 'people' }).success).toBe(false);
    expect(AdminVisitorPresenceResponseSchema.safeParse({ ...value, identifiers: [] }).success).toBe(false);
  });
});
