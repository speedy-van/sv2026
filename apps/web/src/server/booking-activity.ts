import 'server-only';

import {
  BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS, BOOKING_ACTIVITY_COOKIE_NAME, BOOKING_ACTIVITY_RETENTION_HOURS,
  BookingActivityHeartbeatResponseSchema, CONSENT_COOKIE_NAME, parseConsentCookie,
  type BookingActivityHeartbeatRequest, type BookingActivityHeartbeatResponse,
} from '@sv/contracts';
import { prisma, type DbTx } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertVisitorPresenceOrigin } from './visitor-presence';

const SessionIdSchema = z.uuid();
type ActivityDb = Pick<DbTx, 'bookingActivity'>;
interface ActivityResponse { body: BookingActivityHeartbeatResponse; cookie: string | null }

function cookieValue(request: Request, name: string): { present: boolean; value: string | undefined } {
  const entries = (request.headers.get('cookie') ?? '').split(';').map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${name}=`));
  return { present: entries.length > 0, value: entries.length === 1 ? entries[0]?.slice(name.length + 1) : undefined };
}
function sessionCookie(value: string, clear = false): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${BOOKING_ACTIVITY_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? '0' : String(BOOKING_ACTIVITY_RETENTION_HOURS * 3600)}${clear ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`;
}
function acknowledgement(tracked: boolean, cookie: string | null = null): ActivityResponse {
  return { body: BookingActivityHeartbeatResponseSchema.parse({ tracked, activeWindowSeconds: BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS, retentionHours: BOOKING_ACTIVITY_RETENTION_HOURS }), cookie };
}
export function bookingActivityRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - BOOKING_ACTIVITY_RETENTION_HOURS * 3_600_000);
}
function consentedId(request: Request, now: Date): string | null {
  if (!parseConsentCookie(cookieValue(request, CONSENT_COOKIE_NAME).value, now.getTime())?.analytics) return null;
  // Optional analytics must not turn a completed booking/quote write into an
  // error. Requests without a trusted browser origin simply cannot link activity.
  try { assertVisitorPresenceOrigin(request); } catch { return null; }
  const id = SessionIdSchema.safeParse(cookieValue(request, BOOKING_ACTIVITY_COOKIE_NAME).value);
  return id.success ? id.data : null;
}

export async function pruneBookingActivity(now = new Date(), db: ActivityDb = prisma): Promise<number> {
  return (await db.bookingActivity.deleteMany({ where: { lastSeenAt: { lt: bookingActivityRetentionCutoff(now) } } })).count;
}
export async function withdrawBookingActivity(request: Request, db: ActivityDb = prisma): Promise<ActivityResponse> {
  assertVisitorPresenceOrigin(request);
  const id = SessionIdSchema.safeParse(cookieValue(request, BOOKING_ACTIVITY_COOKIE_NAME).value);
  if (id.success) await db.bookingActivity.deleteMany({ where: { id: id.data } });
  return acknowledgement(false, sessionCookie('', true));
}

export async function heartbeatBookingActivity(request: Request, input: BookingActivityHeartbeatRequest, now = new Date()): Promise<ActivityResponse> {
  assertVisitorPresenceOrigin(request);
  const cookie = cookieValue(request, BOOKING_ACTIVITY_COOKIE_NAME);
  if (!parseConsentCookie(cookieValue(request, CONSENT_COOKIE_NAME).value, now.getTime())?.analytics) {
    return cookie.present ? withdrawBookingActivity(request) : acknowledgement(false);
  }
  const id = SessionIdSchema.safeParse(cookie.value);
  if (cookie.present && !id.success) return acknowledgement(false, sessionCookie('', true));
  return prisma.$transaction(async (tx) => {
    await pruneBookingActivity(now, tx);
    if (cookie.present && id.success) {
      const updated = await tx.bookingActivity.updateMany({
        where: { id: id.data, lastSeenAt: { gte: bookingActivityRetentionCutoff(now), lte: now } },
        data: { stage: input.stage, service: input.service, lastSeenAt: now },
      });
      if (updated.count === 1) return acknowledgement(true);
      const current = await tx.bookingActivity.findUnique({ where: { id: id.data }, select: { id: true } });
      // Do not revive a session deleted when consent was withdrawn, and do not
      // let a delayed earlier heartbeat overwrite a newer stage/timestamp.
      return current ? acknowledgement(true) : acknowledgement(false, sessionCookie('', true));
    }
    const createdId = randomUUID();
    await tx.bookingActivity.create({ data: { id: createdId, stage: input.stage, service: input.service, startedAt: now, lastSeenAt: now } });
    return acknowledgement(true, sessionCookie(createdId));
  });
}

/** Called only with the result of creating a quote in this request, never a client-supplied resource ID. */
export async function linkBookingActivityQuote(request: Request, createdQuotePublicId: string, now = new Date(), db: ActivityDb & Pick<DbTx, 'quote'> = prisma): Promise<void> {
  const sessionId = consentedId(request, now);
  if (!sessionId) return;
  const quote = await db.quote.findUnique({ where: { publicId: createdQuotePublicId }, select: { id: true, service: true } });
  if (!quote) return;
  await db.bookingActivity.updateMany({
    where: { id: sessionId, bookingId: null, lastSeenAt: { gte: bookingActivityRetentionCutoff(now), lte: now } },
    data: { quoteId: quote.id, service: quote.service, lastSeenAt: now },
  });
}

/** A booking can be linked only to the quote already bound to this browser's server-issued session. */
export async function linkBookingActivityBooking(request: Request, createdBookingId: string, now = new Date(), db: ActivityDb & Pick<DbTx, 'booking'> = prisma): Promise<void> {
  const sessionId = consentedId(request, now);
  if (!sessionId) return;
  const booking = await db.booking.findUnique({ where: { id: createdBookingId }, select: { id: true, quoteId: true } });
  if (!booking?.quoteId) return;
  await db.bookingActivity.updateMany({
    where: { id: sessionId, quoteId: booking.quoteId, OR: [{ bookingId: null }, { bookingId: booking.id }], lastSeenAt: { gte: bookingActivityRetentionCutoff(now), lte: now } },
    data: { bookingId: booking.id, stage: 'PAYMENT', lastSeenAt: now },
  });
}
