import 'server-only';

import { AppError } from '@sv/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from './env';

interface StatusTokenPayload {
  bookingId: string;
  reference: string;
}

function secret(): string {
  const value = serverEnv().CUSTOMER_LINK_SECRET ?? serverEnv().IP_HASH_SALT;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('INTERNAL', 'CUSTOMER_LINK_SECRET is required.');
  }
  return 'local-status-token-secret';
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function bookingStatusToken(payload: StatusTokenPayload): string {
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyBookingStatusToken(token: string): StatusTokenPayload {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new AppError('UNAUTHORIZED', 'Invalid booking status token.');
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new AppError('UNAUTHORIZED', 'Invalid booking status token.');
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StatusTokenPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid booking status token.');
  }
}
