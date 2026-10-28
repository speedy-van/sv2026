import { z } from 'zod';
import { IsoTimestampSchema } from './api';

export const CONSENT_COOKIE_NAME = 'sv_consent';
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 183;
// Choices are timestamped by the browser. Allow a small clock difference from
// the API so a fresh, explicit opt-in is usable on its first heartbeat.
export const CONSENT_CLOCK_SKEW_SECONDS = 60;

const ConsentCookieSchema = z.object({
  advertising: z.boolean(), analytics: z.boolean(), version: z.literal(1), savedAt: IsoTimestampSchema,
}).strict();
export type ConsentCookie = z.infer<typeof ConsentCookieSchema>;

export function parseConsentCookie(rawValue: string | undefined, nowMs = Date.now()): ConsentCookie | null {
  if (!rawValue || rawValue.length > 2048 || !Number.isFinite(nowMs)) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(rawValue));
    const parsed = ConsentCookieSchema.safeParse(value);
    if (!parsed.success) return null;
    const savedAt = Date.parse(parsed.data.savedAt);
    if (savedAt - nowMs > CONSENT_CLOCK_SKEW_SECONDS * 1000 || nowMs - savedAt >= CONSENT_MAX_AGE_SECONDS * 1000) return null;
    return parsed.data;
  } catch { return null; }
}
