import 'server-only';

import {
  AdminBookingAlertsQuerySchema,
  AdminBookingAlertsResponseSchema,
  AppError,
  BookingAlertReadResponseSchema,
  fromDbDate,
  londonToday,
} from '@sv/contracts';
import { prisma } from '@sv/db';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function town(address: unknown): string | null {
  const value = record(address).town;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function readBookingAlerts(userId: string, search: URLSearchParams, now = new Date()) {
  const parsed = AdminBookingAlertsQuerySchema.safeParse(Object.fromEntries(search));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Check the notification page and try again.');
  const query = parsed.data;
  const rows = await prisma.notification.findMany({
    where: { userId, readAt: null, type: 'booking.confirmed' },
    select: { id: true, createdAt: true, title: true, body: true, data: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  const ids = page.flatMap((row) => {
    const id = record(row.data).bookingId;
    return typeof id === 'string' && id ? [id] : [];
  });
  const bookings = ids.length
    ? await prisma.booking.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          status: 'CONFIRMED',
          moveDate: { gte: new Date(`${londonToday(now)}T00:00:00.000Z`) },
        },
        select: {
          id: true,
          reference: true,
          totalPence: true,
          pickup: true,
          dropoff: true,
          service: true,
          slot: true,
          moveDate: true,
        },
      })
    : [];
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  const items = page.flatMap((row) => {
    const data = record(row.data);
    const booking = typeof data.bookingId === 'string' ? byId.get(data.bookingId) : undefined;
    if (!booking) return [];
    const pickup = town(booking.pickup);
    const dropoff = town(booking.dropoff);
    return [
      {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        title: row.title,
        body: row.body,
        data: {
          bookingId: booking.id,
          deliveryKey: typeof data.deliveryKey === 'string' && data.deliveryKey ? data.deliveryKey : row.id,
          type: 'NEW_BOOKING' as const,
          eventType: 'booking.confirmed' as const,
          reference: booking.reference,
          pricePence: booking.totalPence,
          route: pickup && dropoff ? `${pickup} to ${dropoff}` : (pickup ?? dropoff ?? booking.reference),
          service: booking.service,
          slot: booking.slot,
          moveDate: fromDbDate(booking.moveDate),
        },
      },
    ];
  });
  return AdminBookingAlertsResponseSchema.parse({
    items,
    generatedAt: now.toISOString(),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  });
}

export async function acknowledgeBookingAlerts(userId: string, bookingId: string) {
  await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      type: 'booking.confirmed',
      data: { path: ['bookingId'], equals: bookingId },
    },
    data: { readAt: new Date() },
  });
  return BookingAlertReadResponseSchema.parse({ ok: true });
}
