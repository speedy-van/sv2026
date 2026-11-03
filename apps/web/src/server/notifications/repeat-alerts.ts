import 'server-only';

import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { formatGBP } from '@sv/contracts';
import { dbDateLabel, slotLabel } from '../london-time';
import { getSetting } from '../settings';
import { outboxProcessFrom } from '../env';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function town(address: unknown): string {
  return address && typeof address === 'object' && 'town' in address ? String(address.town) : 'Speedy Van';
}

export async function runRepeatAlerts(now = new Date(), deadline = Number.POSITIVE_INFINITY): Promise<{ bookingsChecked: number; pushesQueued: number }> {
  const processFrom = outboxProcessFrom();
  const settings = await getSetting('notifications');
  if (!settings.newBookingRepeatUntilSeen) return { bookingsChecked: 0, pushesQueued: 0 };
  const repeatDueAt = new Date(now.getTime() - 5 * 60_000);
  // Filter eligibility before LIMIT so already-read or exhausted older bookings
  // cannot permanently occupy the batch and starve newer paid bookings.
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT b."id" FROM "Booking" b
    WHERE b."status" = 'CONFIRMED' AND b."dispatchStatus" = 'UNASSIGNED' AND b."deletedAt" IS NULL
      AND (${processFrom ?? null}::timestamp IS NULL OR b."createdAt" >= ${processFrom ?? null})
      AND EXISTS (
        SELECT 1 FROM "Notification" n
        WHERE n."type" = 'booking.confirmed' AND n."data"->>'bookingId' = b."id" AND n."createdAt" <= ${repeatDueAt}
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Notification" n
        WHERE n."type" = 'booking.confirmed' AND n."data"->>'bookingId' = b."id"
          AND (n."readAt" IS NOT NULL OR n."createdAt" > ${repeatDueAt})
      )
      AND NOT EXISTS (
        SELECT 1 FROM "OutboxEvent" e
        WHERE left(e."dedupeKey", length('repeat-alert:' || b."id" || ':')) = 'repeat-alert:' || b."id" || ':'
          AND (split_part(e."dedupeKey", ':', 3) = '3' OR e."createdAt" > ${repeatDueAt})
      )
    ORDER BY b."createdAt" ASC, b."id" ASC LIMIT 25
  `;
  if (candidates.length === 0) return { bookingsChecked: 0, pushesQueued: 0 };
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'asc' },
    select: { dropoff: true, id: true, moveDate: true, pickup: true, reference: true, service: true, slot: true, totalPence: true },
    take: 25,
    where: { id: { in: candidates.map((candidate) => candidate.id) }, dispatchStatus: 'UNASSIGNED', status: 'CONFIRMED', deletedAt: null, ...(processFrom ? { createdAt: { gte: processFrom } } : {}) },
  });
  const admins = await prisma.user.findMany({
    select: { id: true },
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
  });
  let pushesQueued = 0;
  let bookingsChecked = 0;
  for (const booking of bookings) {
    if (Date.now() >= deadline) break;
    bookingsChecked += 1;
    const title = `New booking - ${formatGBP(booking.totalPence)}`;
    const body = `${booking.service}, ${dbDateLabel(booking.moveDate)} ${slotLabel(booking.slot)}. ${town(booking.pickup)} to ${town(booking.dropoff)}.`;
    pushesQueued += await prisma.$transaction(async (tx) => {
      // Serialize rounds across scheduled/manual invocations; re-check after the
      // lock because another run or an admin may have changed this booking.
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
      const current = await tx.booking.findUnique({ where: { id: booking.id }, select: { dispatchStatus: true, status: true, deletedAt: true } });
      if (!current || current.deletedAt || current.status !== 'CONFIRMED' || current.dispatchStatus !== 'UNASSIGNED') return 0;
      const notifications = await tx.notification.findMany({
        select: { readAt: true, createdAt: true },
        where: { data: { path: ['bookingId'], equals: booking.id }, type: 'booking.confirmed', ...(processFrom ? { createdAt: { gte: processFrom } } : {}) },
      });
      if (notifications.length === 0 || notifications.some((notification) => notification.readAt)) return 0;
      const prefix = `repeat-alert:${booking.id}:`;
      const repeats = await tx.outboxEvent.findMany({ where: { dedupeKey: { startsWith: prefix } }, select: { dedupeKey: true, createdAt: true } });
      // A round has one durable event per admin. Count round numbers, not users.
      const roundNumbers = repeats.map((event) => Number(event.dedupeKey?.slice(prefix.length).split(':')[0])).filter((round) => Number.isInteger(round) && round > 0);
      const lastRound = Math.max(0, ...roundNumbers);
      if (lastRound >= 3) return 0;
      const lastSentAt = Math.max(...notifications.map((notification) => notification.createdAt.getTime()), ...repeats.map((event) => event.createdAt.getTime()));
      if (now.getTime() - lastSentAt < 5 * 60_000) return 0;
      const repeatNumber = lastRound + 1;
      for (const admin of admins) {
        await enqueueOutbox(
          tx,
          'push.send',
          json({
            app: 'ADMIN',
            body,
            category: 'NEW_BOOKING',
            data: {
              bookingId: booking.id,
              eventType: 'booking.confirmed.repeat',
              reference: booking.reference,
              type: 'NEW_BOOKING',
            },
            sound: 'new-job.wav',
            timeSensitive: true,
            title,
            userId: admin.id,
          }),
          `repeat-alert:${booking.id}:${String(repeatNumber)}:${admin.id}`,
        );
      }
      return admins.length;
    });
  }
  return { bookingsChecked, pushesQueued };
}
