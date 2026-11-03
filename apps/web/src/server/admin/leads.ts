import 'server-only';

import {
  ABANDONED_CHECKOUT_WINDOW_DAYS, AddressSchema, AdminAbandonedCheckoutsQuerySchema,
  AdminAbandonedCheckoutsResponseSchema, AdminBookingActivityQuerySchema, AdminBookingActivityResponseSchema,
  AppError, BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS, BOOKING_ACTIVITY_RETENTION_HOURS, BookingActivityStageSchema,
  fromDbDate, type AdminAbandonedCheckoutsResponse, type AdminBookingActivityResponse,
} from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import type { z } from 'zod';
import { bookingActivityRetentionCutoff } from '../booking-activity';

function parseQuery<T extends z.ZodType>(search: URLSearchParams, schema: T): z.infer<T> {
  const parsed = schema.safeParse(Object.fromEntries(search));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Check the filters and try again.');
  return parsed.data;
}

export async function readAdminBookingActivity(search: URLSearchParams, now = new Date()): Promise<AdminBookingActivityResponse> {
  const query = parseQuery(search, AdminBookingActivityQuerySchema);
  const activeCutoff = new Date(now.getTime() - BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS * 1000);
  const where: Prisma.BookingActivityWhereInput = { lastSeenAt: { gte: query.scope === 'active' ? activeCutoff : bookingActivityRetentionCutoff(now), lte: now } };
  if (query.cursor) {
    const cursor = await prisma.bookingActivity.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
    if (!cursor) throw new AppError('VALIDATION_ERROR', 'This activity page expired. Refresh the list.');
  }
  const [rows, stages] = await Promise.all([
    prisma.bookingActivity.findMany({ where,
      select: { id: true, stage: true, service: true, startedAt: true, lastSeenAt: true, quoteId: true,
        booking: { select: { id: true, reference: true, contactName: true, status: true, deletedAt: true } } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.bookingActivity.groupBy({ by: ['stage'], where: { lastSeenAt: { gte: activeCutoff, lte: now } }, _count: { _all: true } }),
  ]);
  const counts = { active: 0, SERVICE: 0, MOVE: 0, ITEMS: 0, DATE: 0, PAYMENT: 0 };
  for (const group of stages) {
    const stage = BookingActivityStageSchema.parse(group.stage);
    counts[stage] = group._count._all;
    counts.active += group._count._all;
  }
  const page = rows.slice(0, query.limit);
  return AdminBookingActivityResponseSchema.parse({
    generatedAt: now.toISOString(), activeWindowSeconds: BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS,
    retentionHours: BOOKING_ACTIVITY_RETENTION_HOURS, measurement: 'consenting-browsers', counts,
    items: page.map((row) => ({ id: row.id, stage: row.stage, service: row.service, startedAt: row.startedAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(), active: row.lastSeenAt >= activeCutoff, quoteId: row.quoteId,
      booking: row.booking && !row.booking.deletedAt ? { id: row.booking.id, reference: row.booking.reference, status: row.booking.status, customerName: row.booking.contactName } : null,
    })),
    nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null,
  });
}

export async function readAdminAbandonedCheckouts(search: URLSearchParams, now = new Date()): Promise<AdminAbandonedCheckoutsResponse> {
  const query = parseQuery(search, AdminAbandonedCheckoutsQuerySchema);
  const cutoff = new Date(now.getTime() - ABANDONED_CHECKOUT_WINDOW_DAYS * 86_400_000);
  const where: Prisma.BookingWhereInput = {
    source: 'WEB', status: 'EXPIRED', deletedAt: null, createdAt: { gte: cutoff, lte: now },
    ...(query.q ? { OR: ['reference', 'contactName', 'contactEmail', 'contactPhone', 'pickupPostcode', 'dropoffPostcode'].map((key) => ({ [key]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  if (query.cursor) {
    const cursor = await prisma.booking.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
    if (!cursor) throw new AppError('VALIDATION_ERROR', 'This checkout page expired. Refresh the list.');
  }
  const rows = await prisma.booking.findMany({ where,
    select: { id: true, reference: true, contactName: true, contactEmail: true, contactPhone: true, service: true,
      pickup: true, dropoff: true, pickupPostcode: true, dropoffPostcode: true, moveDate: true, slot: true,
      totalPence: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  // updatedAt can change after expiration. Only the durable expiry event proves
  // when a checkout expired; older events may already have been retained out.
  const expiryEvents = page.length ? await prisma.outboxEvent.findMany({
    where: { type: 'booking.checkout_abandoned', dedupeKey: { in: page.map((row) => `booking.checkout_abandoned:${row.id}`) } },
    select: { dedupeKey: true, createdAt: true },
  }) : [];
  const expiredAtByKey = new Map(expiryEvents.map((event) => [event.dedupeKey, event.createdAt.toISOString()]));
  return AdminAbandonedCheckoutsResponseSchema.parse({ generatedAt: now.toISOString(), windowDays: ABANDONED_CHECKOUT_WINDOW_DAYS,
    items: page.map((row) => {
      const pickup = AddressSchema.safeParse(row.pickup);
      const dropoff = AddressSchema.safeParse(row.dropoff);
      const from = pickup.success ? pickup.data.town : row.pickupPostcode;
      const to = dropoff.success ? dropoff.data.town : row.dropoffPostcode;
      return { id: row.id, reference: row.reference, customerName: row.contactName, contactEmail: row.contactEmail, contactPhone: row.contactPhone,
        service: row.service, routeLabel: to ? `${from} to ${to}` : from, moveDate: fromDbDate(row.moveDate), slot: row.slot,
        totalPence: row.totalPence, createdAt: row.createdAt.toISOString(), expiredAt: expiredAtByKey.get(`booking.checkout_abandoned:${row.id}`) ?? null };
    }), nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null,
  });
}
