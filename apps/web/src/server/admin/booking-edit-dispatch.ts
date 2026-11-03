import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { prisma } from '@sv/db';
import { after } from 'next/server';
import { processOutboxBatch } from '../outbox/processor';

/** Deliver only the roots created by this committed booking version. */
async function dispatchBookingEdit(bookingId: string, version: number, source: 'admin-booking' | 'driver-booking'): Promise<void> {
  try {
    const roots = await prisma.outboxEvent.findMany({
      where: { dedupeKey: { startsWith: `${source}:${bookingId}:${String(version)}:` } },
      select: { id: true, type: true, payload: true }, orderBy: { createdAt: 'asc' }, take: 50,
    });
    const deadline = Date.now() + 35_000;
    let claims = 0;
    const drain = async (rootEventId: string): Promise<void> => {
      while (claims < 40 && Date.now() < deadline) {
        claims += 1;
        // The root-event scope also covers channel jobs derived by the outbox.
        const result = await processOutboxBatch(1, undefined, { rootEventId });
        if (result.done + result.failed === 0) break;
      }
    };
    for (const root of roots) {
      await drain(root.id);
      // Refund completion uses its own durable root. Follow only the refund
      // created by this edit, never another payment's or historical event.
      if (root.type === 'payment.refund' && root.payload && typeof root.payload === 'object'
        && 'refundId' in root.payload && typeof root.payload.refundId === 'string') {
        const completion = await prisma.outboxEvent.findUnique({
          where: { dedupeKey: `payment.refund.created:${root.payload.refundId}` }, select: { id: true },
        });
        if (completion) await drain(completion.id);
      }
    }
  } catch (error) {
    // Durable events remain eligible for the existing outbox retry mechanism.
    Sentry.captureException(error, { tags: { feature: 'admin-booking-edit-dispatch' } });
  }
}

function scheduleBookingEdit(bookingId: string, version: number, source: 'admin-booking' | 'driver-booking'): void {
  try {
    after(() => dispatchBookingEdit(bookingId, version, source));
  } catch (error) {
    // A scheduling failure cannot roll back an already committed booking edit.
    Sentry.captureException(error, { tags: { feature: 'admin-booking-edit-scheduling' } });
  }
}

export async function dispatchAdminBookingEdit(bookingId: string, version: number): Promise<void> {
  await dispatchBookingEdit(bookingId, version, 'admin-booking');
}
export function scheduleAdminBookingEdit(bookingId: string, version: number): void {
  scheduleBookingEdit(bookingId, version, 'admin-booking');
}
export async function dispatchDriverBookingEdit(bookingId: string, version: number): Promise<void> {
  await dispatchBookingEdit(bookingId, version, 'driver-booking');
}
export function scheduleDriverBookingEdit(bookingId: string, version: number): void {
  scheduleBookingEdit(bookingId, version, 'driver-booking');
}
