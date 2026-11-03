import 'server-only';

import { AppError, CHAT_RETENTION_DAYS } from '@sv/contracts';
import { createHash, randomBytes } from 'node:crypto';

export const CHAT_COOKIE_NAME = 'sv_chat';
export const CHAT_SESSION_SECONDS = CHAT_RETENTION_DAYS * 86_400;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;

export function chatTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readChatToken(request: Request): string | null {
  const parts = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${CHAT_COOKIE_NAME}=`));
  const token = parts.length === 1 ? parts[0]?.slice(CHAT_COOKIE_NAME.length + 1) : undefined;
  return token && tokenPattern.test(token) ? token : null;
}

export function createChatToken(): string { return randomBytes(32).toString('base64url'); }

export function chatCookie(token: string): string {
  if (!tokenPattern.test(token)) throw new AppError('INTERNAL', 'Unable to start this chat.');
  return `${CHAT_COOKIE_NAME}=${token}; Path=/api/v1/chat; HttpOnly; SameSite=Lax; Max-Age=${String(CHAT_SESSION_SECONDS)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function assertChatOrigin(request: Request): void {
  const denied = (): never => { throw new AppError('FORBIDDEN', 'This request must come from this website.'); };
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return denied();
  try {
    const destination = new URL(request.url);
    const host = request.headers.get('host') ?? destination.host;
    if (!host || /[\\/@?#\s,]/u.test(host)) denied();
    const source = new URL(origin);
    if (source.origin !== origin || source.origin !== new URL(`${destination.protocol}//${host}`).origin) denied();
  } catch (error) {
    if (error instanceof AppError) throw error;
    denied();
  }
}
