import 'server-only';

import { AppError } from '@sv/contracts';
import { prisma } from '@sv/db';
import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { serverEnv } from '../env';

export const CUSTOMER_LINK_PURPOSES = ['manage', 'status', 'track', 'review', 'pay', 'file'] as const;
export type CustomerLinkPurpose = (typeof CUSTOMER_LINK_PURPOSES)[number];

interface CustomerLinkPayload {
  bookingId?: string;
  email: string;
  expiresAt: Date;
  purpose: CustomerLinkPurpose;
  subject: string;
}

export interface VerifiedCustomerLink {
  emailHash: string;
  purpose: CustomerLinkPurpose;
  subject: string;
}

function secret(): Uint8Array {
  const value = serverEnv().CUSTOMER_LINK_SECRET ?? serverEnv().IP_HASH_SALT;
  if (value) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === 'production') throw new AppError('INTERNAL', 'CUSTOMER_LINK_SECRET is required.');
  return new TextEncoder().encode('local-customer-link-secret');
}

export function contactEmailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export async function signCustomerLink(payload: CustomerLinkPayload): Promise<string> {
  return new SignJWT({ bid: payload.bookingId, eh: contactEmailHash(payload.email) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.subject)
    .setAudience(payload.purpose)
    .setExpirationTime(Math.floor(payload.expiresAt.getTime() / 1000))
    .sign(secret());
}

export async function verifyCustomerLink(token: string, purpose: CustomerLinkPurpose): Promise<VerifiedCustomerLink> {
  try {
    const verified = await jwtVerify(token, secret(), { audience: purpose });
    const subject = verified.payload.sub;
    const emailHash = verified.payload.eh;
    if (!subject || typeof emailHash !== 'string') throw new AppError('UNAUTHORIZED', 'Invalid customer link.');
    return { emailHash, purpose, subject };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('UNAUTHORIZED', 'This link has expired or is invalid.');
  }
}

export async function verifyBookingLink(token: string, purpose: CustomerLinkPurpose): Promise<{ bookingId: string }> {
  const payload = await verifyCustomerLink(token, purpose);
  const booking = await prisma.booking.findUnique({
    where: { id: payload.subject },
    select: { contactEmail: true, id: true },
  });
  if (!booking || contactEmailHash(booking.contactEmail) !== payload.emailHash) {
    throw new AppError('UNAUTHORIZED', 'This link has expired or is invalid.');
  }
  return { bookingId: booking.id };
}

export async function manageLinkForBooking(booking: { contactEmail: string; id: string; moveDate: Date }, now = new Date()): Promise<string> {
  const sevenDays = now.getTime() + 7 * 86_400_000;
  const movePlusThirty = booking.moveDate.getTime() + 30 * 86_400_000;
  return signCustomerLink({
    bookingId: booking.id,
    email: booking.contactEmail,
    expiresAt: new Date(Math.max(sevenDays, movePlusThirty)),
    purpose: 'manage',
    subject: booking.id,
  });
}

export async function shortManageCookieToken(booking: { contactEmail: string; id: string }, now = new Date()): Promise<string> {
  return signCustomerLink({
    bookingId: booking.id,
    email: booking.contactEmail,
    expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    purpose: 'manage',
    subject: booking.id,
  });
}

export async function bookingPurposeLink(
  booking: { contactEmail: string; id: string },
  purpose: Exclude<CustomerLinkPurpose, 'manage' | 'pay' | 'file'>,
  expiresAt: Date,
): Promise<string> {
  return signCustomerLink({
    bookingId: booking.id,
    email: booking.contactEmail,
    expiresAt,
    purpose,
    subject: booking.id,
  });
}
