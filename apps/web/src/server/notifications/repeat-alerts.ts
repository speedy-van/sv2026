import 'server-only';

import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { formatGBP } from '@sv/contracts';
import { dbDateLabel, slotLabel } from '../london-time';
import { getSetting } from '../settings';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function town(address: unknown): string {
  return address && typeof address === 'object' && 'town' in address ? String(address.town) : 'Speedy Van';
}

export async function runRepeatAlerts(): Promise<{ bookingsChecked: number; pushesQueued: number }> {
  const settings = await getSetting('notifications');
  if (!settings.newBookingRepeatUntilSeen) return { bookingsChecked: 0, pushesQueued: 0 };
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'asc' },
    select: { dropoff: true, id: true, moveDate: true, pickup: true, reference: true, service: true, slot: true, totalPence: true },
    take: 25,
    where: { dispatchStatus: 'UNASSIGNED', status: 'CONFIRMED' },
  });
  const admins = await prisma.user.findMany({
    select: { id: true },
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
  });
  let pushesQueued = 0;
  for (const booking of bookings) {
    const notifications = await prisma.notification.findMany({
      select: { readAt: true },
      where: {
        data: { path: ['bookingId'], equals: booking.id },
        type: 'booking.confirmed',
      },
    });
    if (notifications.length === 0 || notifications.some((notification) => notification.readAt)) continue;
    const repeats = await prisma.outboxEvent.count({ where: { dedupeKey: { startsWith: `repeat-alert:${booking.id}:` } } });
    if (repeats >= 3) continue;
    const repeatNumber = repeats + 1;
    const title = `New booking - ${formatGBP(booking.totalPence)}`;
    const body = `${booking.service}, ${dbDateLabel(booking.moveDate)} ${slotLabel(booking.slot)}. ${town(booking.pickup)} to ${town(booking.dropoff)}.`;
    await prisma.$transaction(async (tx) => {
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
        pushesQueued += 1;
      }
    });
  }
  return { bookingsChecked: bookings.length, pushesQueued };
}
