import 'server-only';

import { addDays, fromDbDate, londonToday } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { dbDateLabel, slotLabel } from './london-time';
import { getSetting } from './settings';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function londonHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(now);
  return Number(hour);
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const pickupTown = pickup && typeof pickup === 'object' && 'town' in pickup ? String(pickup.town) : 'Pickup';
  const dropoffTown = dropoff && typeof dropoff === 'object' && 'town' in dropoff ? String(dropoff.town) : null;
  return dropoffTown ? `${pickupTown} to ${dropoffTown}` : pickupTown;
}

export async function runDataRetention(now = new Date()): Promise<{ authOtpDeleted: number; oldPushTicketsDeleted: number }> {
  const authOtp = await prisma.authOtp.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
  });
  const pushTickets = await prisma.pushTicket.deleteMany({
    where: { checkedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } },
  });
  return { authOtpDeleted: authOtp.count, oldPushTicketsDeleted: pushTickets.count };
}

export async function runIntegrityChecks(now = new Date()): Promise<{ alertsQueued: number; stuckOutboxReset: number }> {
  const stuck = await prisma.outboxEvent.updateMany({
    data: {
      lastError: 'Reset by integrity cron after being stuck in PROCESSING.',
      nextAttemptAt: now,
      status: 'PENDING',
    },
    where: { nextAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) }, status: 'PROCESSING' },
  });
  if (stuck.count === 0) return { alertsQueued: 0, stuckOutboxReset: 0 };
  await prisma.outboxEvent.create({
    data: {
      dedupeKey: `system.alert:integrity:stuck-outbox:${now.toISOString().slice(0, 10)}`,
      payload: json({ issue: `${String(stuck.count)} stuck outbox events were reset by integrity cron.` }),
      type: 'system.alert',
    },
  }).catch(() => undefined);
  return { alertsQueued: 1, stuckOutboxReset: stuck.count };
}

async function adminEmails(): Promise<string[]> {
  const users = await prisma.user.findMany({
    select: { email: true },
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
  });
  const contact = await getSetting('contact');
  return contact.emailAdminAlerts.length > 0 ? contact.emailAdminAlerts : users.map((user) => user.email);
}

async function runDailySummary(today: string): Promise<number> {
  const [jobs, unassigned, emails] = await Promise.all([
    prisma.booking.count({ where: { moveDate: new Date(`${today}T00:00:00.000Z`), status: { in: ['CONFIRMED', 'IN_PROGRESS'] } } }),
    prisma.booking.count({ where: { dispatchStatus: 'UNASSIGNED', moveDate: new Date(`${today}T00:00:00.000Z`), status: 'CONFIRMED' } }),
    adminEmails(),
  ]);
  if (emails.length === 0) return 0;
  await prisma.outboxEvent.create({
    data: {
      dedupeKey: `cron.daily-summary:${today}`,
      payload: json({
        data: { message: `${String(jobs)} moves today, ${String(unassigned)} need a driver.` },
        template: 'admin-daily-summary',
        to: emails,
      }),
      type: 'email.send',
    },
  }).catch(() => undefined);
  return 1;
}

async function runReminders(today: string): Promise<number> {
  const tomorrow = addDays(today, 1);
  const bookings = await prisma.booking.findMany({
    select: {
      contactEmail: true,
      id: true,
      moveDate: true,
      pickup: true,
      dropoff: true,
      reference: true,
      reminderSentAt: true,
      slot: true,
      totalPence: true,
    },
    take: 100,
    where: {
      moveDate: new Date(`${tomorrow}T00:00:00.000Z`),
      reminderSentAt: null,
      status: 'CONFIRMED',
    },
  });
  const [web, contact, company] = await Promise.all([getSetting('web'), getSetting('contact'), getSetting('company')]);
  let sent = 0;
  for (const booking of bookings) {
    await prisma.$transaction(async (tx) => {
      await enqueueOutbox(
        tx,
        'email.send',
        json({
          data: {
            amountPence: booking.totalPence,
            canonicalOrigin: web.canonicalOrigin,
            contactEmail: contact.emailBookings ?? contact.emailPublic,
            legalLine: company.legalName ? `${company.legalName}. Booking reference ${booking.reference}.` : `Booking reference ${booking.reference}.`,
            moveDateLabel: dbDateLabel(booking.moveDate),
            reference: booking.reference,
            routeLabel: routeLabel(booking.pickup, booking.dropoff),
            slotLabel: slotLabel(booking.slot),
          },
          template: 'reminder-day-before',
          to: [booking.contactEmail],
        }),
        `cron.reminder:${booking.id}:${fromDbDate(booking.moveDate)}`,
      );
      await tx.booking.update({ data: { reminderSentAt: new Date() }, where: { id: booking.id } });
      sent += 1;
    });
  }
  return sent;
}

async function runDocumentExpiry(today: string): Promise<number> {
  const thresholds = [30, 14, 7, 1];
  let alerts = 0;
  for (const days of thresholds) {
    const date = new Date(`${addDays(today, days)}T00:00:00.000Z`);
    const [drivers, vans] = await Promise.all([
      prisma.driverProfile.findMany({ select: { userId: true }, where: { licenceExpiry: date } }),
      prisma.van.findMany({ select: { id: true, label: true }, where: { OR: [{ insuranceExpiry: date }, { motExpiry: date }, { taxExpiry: date }] } }),
    ]);
    for (const driver of drivers) {
      await prisma.outboxEvent.create({
        data: {
          dedupeKey: `cron.document-expiry:driver-licence:${driver.userId}:${String(days)}`,
          payload: json({
            app: 'DRIVER',
            body: `Your licence expires in ${String(days)} day${days === 1 ? '' : 's'}.`,
            category: 'FLEET',
            data: { eventType: 'document-expiry', type: 'FLEET' },
            sound: 'default',
            title: 'Document expiry',
            userId: driver.userId,
          }),
          type: 'push.send',
        },
      }).catch(() => undefined);
      alerts += 1;
    }
    if (vans.length > 0) {
      await prisma.outboxEvent.create({
        data: {
          dedupeKey: `cron.document-expiry:fleet:${today}:${String(days)}`,
          payload: json({ issue: `${String(vans.length)} fleet documents expire in ${String(days)} day(s).` }),
          type: 'system.alert',
        },
      }).catch(() => undefined);
      alerts += 1;
    }
  }
  return alerts;
}

export async function runHourlyCron(now = new Date()): Promise<{ dailySummaries: number; documentAlerts: number; hour: number; reminders: number }> {
  const today = londonToday(now);
  const hour = londonHour(now);
  const reminders = hour === 17 ? await runReminders(today) : 0;
  const dailySummaries = hour === 7 ? await runDailySummary(today) : 0;
  const documentAlerts = hour === 6 ? await runDocumentExpiry(today) : 0;
  return { dailySummaries, documentAlerts, hour, reminders };
}
