import 'server-only';

import { addDays, fromDbDate, londonToday } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { dbDateLabel, slotLabel } from './london-time';
import { getSetting } from './settings';
import { pruneVisitorPresence } from './visitor-presence';
import { pruneExpiredChatConversations } from './chat/retention';
import { outboxProcessFrom } from './env';

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

export async function runDataRetention(now = new Date()): Promise<{ authOtpDeleted: number; oldPushTicketsDeleted: number; chatsDeleted: number }> {
  const authOtp = await prisma.authOtp.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
  });
  const pushTickets = await prisma.pushTicket.deleteMany({
    where: { checkedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } },
  });
  const chatsDeleted = await pruneExpiredChatConversations(now);
  return { authOtpDeleted: authOtp.count, oldPushTicketsDeleted: pushTickets.count, chatsDeleted };
}

export async function runIntegrityChecks(now = new Date()): Promise<{ alertsQueued: number; stuckOutboxReset: number }> {
  const processFrom = outboxProcessFrom();
  const stuck = await prisma.outboxEvent.updateMany({
    data: {
      lastError: 'Reset by integrity cron after being stuck in PROCESSING.',
      nextAttemptAt: now,
      status: 'PENDING',
    },
    where: {
      nextAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) }, status: 'PROCESSING',
      ...(processFrom ? { createdAt: { gte: processFrom } } : {}),
    },
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

async function queueSystemAlert(key: string, issue: string): Promise<boolean> {
  await prisma.outboxEvent.create({
    data: {
      dedupeKey: key,
      payload: json({ issue }),
      type: 'system.alert',
    },
  });
  return true;
}

async function tryQueueSystemAlert(key: string, issue: string): Promise<boolean> {
  return queueSystemAlert(key, issue).catch(() => false);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export async function runBusinessAlarms(now = new Date()): Promise<{
  alertsQueued: number;
  checkoutConversionRate: number | null;
  pushFailureRate: number | null;
  webhookSilenceHours: number | null;
}> {
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
  const dedupeHour = now.toISOString().slice(0, 13);
  let alertsQueued = 0;

  const [recentBookings, lastWebhook, recentTickets, failedTickets, currentCheckouts, currentPaid, baselineCheckouts, baselinePaid] =
    await Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: sixHoursAgo } } }),
      prisma.stripeEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      prisma.pushTicket.count({ where: { createdAt: { gte: sixHoursAgo } } }),
      prisma.pushTicket.count({
        where: {
          createdAt: { gte: sixHoursAgo },
          OR: [{ error: { not: null } }, { status: 'error' }],
        },
      }),
      prisma.booking.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.booking.count({ where: { createdAt: { gte: oneDayAgo }, status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } } }),
      prisma.booking.count({ where: { createdAt: { gte: eightDaysAgo, lt: oneDayAgo } } }),
      prisma.booking.count({
        where: {
          createdAt: { gte: eightDaysAgo, lt: oneDayAgo },
          status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        },
      }),
    ]);

  const webhookSilenceHours = lastWebhook ? (now.getTime() - lastWebhook.receivedAt.getTime()) / 3_600_000 : null;
  if (recentBookings > 0 && (webhookSilenceHours === null || webhookSilenceHours > 6)) {
    const queued = await tryQueueSystemAlert(
      `system.alert:business:webhook-silence:${dedupeHour}`,
      'No Stripe webhook has been received for over 6 hours while bookings were created.',
    );
    if (queued) alertsQueued += 1;
  }

  const pushFailureRate = recentTickets >= 10 ? rate(failedTickets, recentTickets) : null;
  if (pushFailureRate !== null && pushFailureRate > 0.1) {
    const queued = await tryQueueSystemAlert(
      `system.alert:business:push-failure-rate:${dedupeHour}`,
      `Push failure rate is ${String(Math.round(pushFailureRate * 100))}% over the last 6 hours.`,
    );
    if (queued) alertsQueued += 1;
  }

  const checkoutConversionRate = currentCheckouts >= 10 ? rate(currentPaid, currentCheckouts) : null;
  const baselineConversionRate = baselineCheckouts >= 10 ? rate(baselinePaid, baselineCheckouts) : null;
  if (
    checkoutConversionRate !== null &&
    baselineConversionRate !== null &&
    baselineConversionRate > 0 &&
    checkoutConversionRate < baselineConversionRate / 2
  ) {
    const queued = await tryQueueSystemAlert(
      `system.alert:business:checkout-conversion:${dedupeHour}`,
      `Checkout conversion dropped to ${String(Math.round(checkoutConversionRate * 100))}%, less than half the 7-day baseline.`,
    );
    if (queued) alertsQueued += 1;
  }

  return {
    alertsQueued,
    checkoutConversionRate,
    pushFailureRate,
    webhookSilenceHours,
  };
}

export async function runHourlyCron(now = new Date()): Promise<{
  businessAlerts: number;
  dailySummaries: number;
  documentAlerts: number;
  hour: number;
  reminders: number;
  visitorPresenceDeleted: number;
}> {
  const today = londonToday(now);
  const hour = londonHour(now);
  const [reminders, dailySummaries, documentAlerts, businessAlarms, visitorPresenceDeleted] = await Promise.all([
    hour === 17 ? runReminders(today) : Promise.resolve(0),
    hour === 7 ? runDailySummary(today) : Promise.resolve(0),
    hour === 6 ? runDocumentExpiry(today) : Promise.resolve(0),
    runBusinessAlarms(now),
    pruneVisitorPresence(now),
  ]);
  return { businessAlerts: businessAlarms.alertsQueued, dailySummaries, documentAlerts, hour, reminders, visitorPresenceDeleted };
}
