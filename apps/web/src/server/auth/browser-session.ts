import 'server-only';

import {
  AppError, BrowserAuthTokenResponseSchema, DeviceSchema,
  type BrowserAuthTokenResponse,
} from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { issueStaffAccessResponse } from './staff';

export const BROWSER_SESSION_COOKIE_NAME = 'sv_admin_session';
const cookiePath = '/api/v1/auth';
const cookieMaxAge = 400 * 86_400;
const CookieSchema = z.object({
  token: z.string().min(20).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  deviceId: DeviceSchema.shape.deviceId,
}).strict();
const sessionSelect = {
  id: true, app: true, platform: true, deviceId: true, revokedAt: true, expiresAt: true,
  user: { select: { id: true, email: true, name: true, role: true, status: true } },
} as const satisfies Prisma.SessionSelect;

function unauthorized(): never { throw new AppError('UNAUTHORIZED', 'Sign in required.'); }

/** Browser credentials are accepted only from the website or its paired local admin preview. */
export function assertBrowserSessionOrigin(request: Request): void {
  const denied = (): never => { throw new AppError('FORBIDDEN', 'This sign-in request must come from the admin app.'); };
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite))) return denied();
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') denied();
    const host = request.headers.get('host') ?? url.host;
    if (!host || /[\\/@?#\s,]/u.test(host)) denied();
    const destination = new URL(`${url.protocol}//${host}`);
    const source = new URL(origin);
    if (source.origin !== origin) denied();
    if (source.origin === destination.origin) return;
    const developmentPair = process.env.NODE_ENV === 'development'
      && destination.protocol === 'http:' && destination.port === '3000'
      && (destination.hostname === 'localhost' || destination.hostname === '127.0.0.1')
      && source.protocol === 'http:' && source.hostname === destination.hostname && source.port === '8081';
    if (!developmentPair) denied();
  } catch (error) {
    if (error instanceof AppError) throw error;
    denied();
  }
}

function readCookie(request: Request): z.infer<typeof CookieSchema> | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${BROWSER_SESSION_COOKIE_NAME}=`));
  const value = matches.length === 1 ? matches[0]?.slice(BROWSER_SESSION_COOKIE_NAME.length + 1) : undefined;
  if (!value || value.length > 2048) return null;
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(value));
    const parsed = CookieSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function browserSessionCookie(token: string, deviceId: string): string {
  const value = CookieSchema.parse({ token, deviceId });
  return `${BROWSER_SESSION_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${String(cookieMaxAge)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function clearBrowserSessionCookie(): string {
  return `${BROWSER_SESSION_COOKIE_NAME}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function browserLoginResult(response: BrowserAuthTokenResponse & { refreshToken: string }, deviceId: string): {
  body: BrowserAuthTokenResponse; cookie: string;
} {
  return {
    body: BrowserAuthTokenResponseSchema.parse({ accessToken: response.accessToken, accessExpiresAt: response.accessExpiresAt, user: response.user }),
    cookie: browserSessionCookie(response.refreshToken, deviceId),
  };
}

function currentHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export async function restoreBrowserSession(request: Request, now = new Date()): Promise<{ body: BrowserAuthTokenResponse; cookie: string }> {
  assertBrowserSessionOrigin(request);
  const credential = readCookie(request);
  if (!credential) return unauthorized();
  const refreshTokenHash = currentHash(credential.token);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash }, select: sessionSelect });
  if (!session || session.app !== 'ADMIN' || session.platform !== 'WEB' || session.deviceId !== credential.deviceId
    || session.revokedAt || (session.expiresAt !== null && session.expiresAt.getTime() <= now.getTime())
    || session.user.status !== 'ACTIVE' || (session.user.role !== 'OWNER' && session.user.role !== 'ADMIN')) return unauthorized();
  const updated = await prisma.session.updateMany({
    where: {
      id: session.id, refreshTokenHash, deviceId: credential.deviceId, app: 'ADMIN', platform: 'WEB', revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      user: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    },
    data: { lastUsedAt: now, expiresAt: null },
  });
  if (updated.count !== 1) return unauthorized();
  return {
    body: BrowserAuthTokenResponseSchema.parse(await issueStaffAccessResponse(session.user, session.id, 'admin')),
    cookie: browserSessionCookie(credential.token, credential.deviceId),
  };
}

export async function logoutBrowserSession(request: Request, now = new Date()): Promise<void> {
  assertBrowserSessionOrigin(request);
  const credential = readCookie(request);
  if (!credential) return;
  const refreshTokenHash = currentHash(credential.token);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash }, select: sessionSelect });
  if (!session || session.app !== 'ADMIN' || session.platform !== 'WEB' || session.deviceId !== credential.deviceId) return;
  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: session.id, refreshTokenHash, deviceId: credential.deviceId, app: 'ADMIN', platform: 'WEB' },
      data: { revokedAt: now, revokedReason: 'logout' },
    });
    await tx.pushDevice.updateMany({ where: { sessionId: session.id }, data: { enabled: false } });
  });
}
