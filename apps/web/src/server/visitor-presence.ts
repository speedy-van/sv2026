import 'server-only';

import {
  AdminVisitorPresenceResponseSchema, AppError, CONSENT_COOKIE_NAME, parseConsentCookie,
  VISITOR_ACTIVE_WINDOW_SECONDS, VISITOR_PRESENCE_COOKIE_NAME, VisitorPresenceHeartbeatResponseSchema,
  type AdminVisitorPresenceResponse, type VisitorPresenceHeartbeatResponse,
} from '@sv/contracts';
import { prisma, type DbTx } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const VisitorIdSchema = z.uuid();
interface PresenceResponse { body: VisitorPresenceHeartbeatResponse; cookie: string | null }

function cookieValue(request: Request, name: string): { present: boolean; value: string | undefined } {
  const values = (request.headers.get('cookie') ?? '').split(';').map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${name}=`));
  return { present: values.length > 0, value: values.length === 1 ? values[0]?.slice(name.length + 1) : undefined };
}

function visitorCookie(value: string, clear = false): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${VISITOR_PRESENCE_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}${clear ? '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`;
}

function acknowledgement(cookie: string | null = null): PresenceResponse {
  return { body: VisitorPresenceHeartbeatResponseSchema.parse({ activeWindowSeconds: VISITOR_ACTIVE_WINDOW_SECONDS }), cookie };
}

export function assertVisitorPresenceOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  const denied = (): never => { throw new AppError('FORBIDDEN', 'This request must come from this website.'); };
  if (!origin || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) return denied();
  try {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? url.host;
    if (!host || /[\\/@?#\s]/u.test(host)) denied();
    const expected = new URL(`${url.protocol}//${host}`).origin;
    const supplied = new URL(origin);
    if (supplied.origin !== origin.toLowerCase() || supplied.origin !== expected) denied();
  } catch (error) {
    if (error instanceof AppError) throw error;
    denied();
  }
}

function activeCutoff(now: Date): Date {
  return new Date(now.getTime() - VISITOR_ACTIVE_WINDOW_SECONDS * 1000);
}

export async function pruneVisitorPresence(now = new Date(), db: Pick<DbTx, 'websiteVisitorPresence'> = prisma): Promise<number> {
  const deleted = await db.websiteVisitorPresence.deleteMany({ where: { lastSeenAt: { lt: activeCutoff(now) } } });
  return deleted.count;
}

export async function heartbeatVisitorPresence(request: Request, now = new Date()): Promise<PresenceResponse> {
  assertVisitorPresenceOrigin(request);
  const consent = parseConsentCookie(cookieValue(request, CONSENT_COOKIE_NAME).value, now.getTime());
  if (!consent?.analytics) return acknowledgement();
  const cookie = cookieValue(request, VISITOR_PRESENCE_COOKIE_NAME);
  const visitorId = VisitorIdSchema.safeParse(cookie.value);
  if (cookie.present && !visitorId.success) return acknowledgement(visitorCookie('', true));

  return prisma.$transaction(async (tx) => {
    await pruneVisitorPresence(now, tx);
    if (cookie.present && visitorId.success) {
      // A delayed heartbeat must never recreate an identifier removed on consent withdrawal.
      const updated = await tx.websiteVisitorPresence.updateMany({
        where: { id: visitorId.data, lastSeenAt: { gte: activeCutoff(now), lte: now } }, data: { lastSeenAt: now },
      });
      if (updated.count === 1) return acknowledgement();
      // Do not move a newer, server-issued heartbeat timestamp backwards.
      const current = await tx.websiteVisitorPresence.findUnique({ where: { id: visitorId.data }, select: { lastSeenAt: true } });
      return current ? acknowledgement() : acknowledgement(visitorCookie('', true));
    }
    const id = randomUUID();
    await tx.websiteVisitorPresence.upsert({ where: { id }, create: { id, lastSeenAt: now }, update: { lastSeenAt: now } });
    return acknowledgement(visitorCookie(id));
  });
}

export async function withdrawVisitorPresence(request: Request): Promise<PresenceResponse> {
  assertVisitorPresenceOrigin(request);
  const id = VisitorIdSchema.safeParse(cookieValue(request, VISITOR_PRESENCE_COOKIE_NAME).value);
  if (id.success) await prisma.websiteVisitorPresence.deleteMany({ where: { id: id.data } });
  return acknowledgement(visitorCookie('', true));
}

export async function readAdminVisitorPresence(now = new Date()): Promise<AdminVisitorPresenceResponse> {
  const activeVisitors = await prisma.websiteVisitorPresence.count({ where: { lastSeenAt: { gte: activeCutoff(now) } } });
  return AdminVisitorPresenceResponseSchema.parse({
    activeVisitors, generatedAt: now.toISOString(), activeWindowSeconds: VISITOR_ACTIVE_WINDOW_SECONDS, measurement: 'consenting-browsers',
  });
}
