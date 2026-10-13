import 'server-only';

import { addDays as addLondonDays, formatGBP, fromDbDate, londonToday } from '@sv/contracts';
import { enqueueOutbox, Prisma, prisma, type DbTx } from '@sv/db';
import type { EmailTemplateData, EmailTemplateKey } from '@sv/emails';
import { sendPushOutbox, type PushSendPayload } from '../integrations/expo-push';
import { sendTransactionalEmail, type EmailSendPayload } from '../integrations/resend';
import { dbDateLabel, londonDateTimeToUtc, slotLabel } from '../london-time';
import { channelsForEvent, type MatrixChannels } from '../notifications/matrix';
import { getSetting } from '../settings';
import { bookingPurposeLink, manageLinkForBooking } from '../auth/customer-links';
import { payLinkForExtraCharge, payLinkForManualQuote } from '../services/customer-self-service';
import { runRefundOutbox } from '../services/payments';

interface ClaimedOutboxEvent {
  attempts: number;
  id: string;
  payload: unknown;
  type: string;
}

interface EventPayload {
  bookingId?: string;
  contactMessageId?: string;
  driverId?: string;
  extraChargeId?: string;
  issue?: string;
  manualQuoteId?: string;
  paymentId?: string;
  payoutId?: string;
  previousDriverId?: string;
  quoteId?: string;
  refundId?: string;
  refundPence?: number;
  toStage?: string;
}

type AdminPushConfig = NonNullable<MatrixChannels['adminPush']>;
type DriverPushTarget = NonNullable<MatrixChannels['driverPush']>['target'];

const BACKOFF_MINUTES = [1, 5, 15, 60, 360] as const;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asPayload(value: unknown): EventPayload {
  return value && typeof value === 'object' ? value : {};
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const pickupTown = pickup && typeof pickup === 'object' && 'town' in pickup ? String(pickup.town) : 'Pickup';
  const dropoffTown = dropoff && typeof dropoff === 'object' && 'town' in dropoff ? String(dropoff.town) : null;
  return dropoffTown ? `${pickupTown} to ${dropoffTown}` : pickupTown;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

async function adminUsers(tx: DbTx, options: { ownerOnly?: boolean } = {}) {
  return tx.user.findMany({
    where: { role: options.ownerOnly ? 'OWNER' : { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { email: true, id: true, name: true },
  });
}

async function adminEmails(tx: DbTx): Promise<string[]> {
  const users = await adminUsers(tx);
  const contact = await getSetting('contact');
  const configured = contact.emailAdminAlerts;
  return configured.length > 0 ? configured : users.map((user) => user.email);
}

async function bookingEmailData(tx: DbTx, bookingId: string, extra: Partial<EmailTemplateData> = {}): Promise<{ customerEmail: string; data: EmailTemplateData }> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      contactEmail: true,
      completedAt: true,
      dropoff: true,
      id: true,
      moveDate: true,
      pickup: true,
      reference: true,
      service: true,
      slot: true,
      totalPence: true,
    },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  const [web, contact, company] = await Promise.all([getSetting('web'), getSetting('contact'), getSetting('company')]);
  const [manageToken, trackToken, reviewToken] = await Promise.all([
    manageLinkForBooking(booking),
    bookingPurposeLink(booking, 'track', addDays(booking.moveDate, 2)),
    booking.completedAt ? bookingPurposeLink(booking, 'review', addDays(booking.completedAt, 60)) : Promise.resolve(null),
  ]);
  const data: EmailTemplateData = {
    amountPence: booking.totalPence,
    canonicalOrigin: web.canonicalOrigin,
    contactEmail: contact.emailBookings ?? contact.emailPublic,
    legalLine: company.legalName ? `${company.legalName}. Booking reference ${booking.reference}.` : `Booking reference ${booking.reference}.`,
    manageUrl: `/manage/session?token=${encodeURIComponent(manageToken)}`,
    moveDateLabel: dbDateLabel(booking.moveDate),
    reference: booking.reference,
    routeLabel: routeLabel(booking.pickup, booking.dropoff),
    serviceLabel: booking.service,
    slotLabel: slotLabel(booking.slot),
    ...(reviewToken ? { reviewUrl: `/review/${encodeURIComponent(reviewToken)}` } : {}),
    trackingUrl: `/track/${encodeURIComponent(trackToken)}`,
    ...extra,
  };
  return { customerEmail: booking.contactEmail, data };
}

async function manualQuoteEmailData(tx: DbTx, payload: EventPayload): Promise<{ customerEmail: string; data: EmailTemplateData }> {
  const where = payload.manualQuoteId ? { id: payload.manualQuoteId } : payload.quoteId ? { quoteId: payload.quoteId } : undefined;
  if (!where) throw new Error('Manual quote id missing');
  const manualQuote = await tx.manualQuote.findFirst({
    where,
    select: {
      contactEmail: true,
      details: true,
      id: true,
      pricePence: true,
      quoteId: true,
      validUntil: true,
    },
  });
  if (!manualQuote) throw new Error('Manual quote not found');
  const quote = await tx.quote.findUnique({
    where: { id: manualQuote.quoteId },
    select: { dropoff: true, pickup: true },
  });
  if (!quote) throw new Error('Manual quote source quote not found');
  const [web, contact] = await Promise.all([getSetting('web'), getSetting('contact')]);
  const details = manualQuote.details ?? undefined;
  const payToken = manualQuote.pricePence && manualQuote.validUntil ? await payLinkForManualQuote(manualQuote) : null;
  return {
    customerEmail: manualQuote.contactEmail,
    data: {
      amountPence: manualQuote.pricePence ?? 0,
      canonicalOrigin: web.canonicalOrigin,
      contactEmail: contact.emailBookings ?? contact.emailPublic,
      ...(payToken ? { payUrl: `/pay/${encodeURIComponent(payToken)}` } : {}),
      reference: `MQ-${manualQuote.id.slice(-8).toUpperCase()}`,
      routeLabel: routeLabel(quote.pickup, quote.dropoff),
      ...(details ? { message: details } : {}),
    },
  };
}

async function contactEmailData(tx: DbTx, payload: EventPayload): Promise<{ customerEmail: string; data: EmailTemplateData } | null> {
  if (!payload.contactMessageId) return null;
  const message = await tx.contactMessage.findUnique({
    where: { id: payload.contactMessageId },
    select: { email: true, message: true },
  });
  if (!message) return null;
  const [web, contact] = await Promise.all([getSetting('web'), getSetting('contact')]);
  return {
    customerEmail: message.email,
    data: {
      canonicalOrigin: web.canonicalOrigin,
      contactEmail: contact.emailBookings ?? contact.emailPublic,
      message: message.message,
      reference: `CM-${payload.contactMessageId.slice(-8).toUpperCase()}`,
    },
  };
}

async function enqueueEmail(tx: DbTx, event: ClaimedOutboxEvent, template: EmailTemplateKey, to: string | string[], data: EmailTemplateData): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) return;
  await enqueueOutbox(
    tx,
    'email.send',
    json({ data, template, to: recipients } satisfies EmailSendPayload),
    `${event.id}:email:${template}:${recipients.join(',')}`,
  );
}

async function enqueueAdminNotification(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  options: { ownerOnly?: boolean } = {},
): Promise<void> {
  const users = await adminUsers(tx, options);
  for (const user of users) {
    await enqueueOutbox(
      tx,
      'notification.create',
      json({ body, data, title, type: event.type, userId: user.id }),
      `${event.id}:notification:${user.id}`,
    );
  }
}

async function enqueuePush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  userId: string,
  payload: Omit<PushSendPayload, 'userId'>,
  options: { dedupeSuffix: string; nextAttemptAt?: Date },
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      ...(options.nextAttemptAt ? { nextAttemptAt: options.nextAttemptAt } : {}),
      dedupeKey: `${event.id}:push:${options.dedupeSuffix}:${userId}`,
      payload: json({ ...payload, userId } satisfies PushSendPayload),
      type: 'push.send',
    },
  });
}

async function enqueueAdminPush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  push: AdminPushConfig | undefined,
): Promise<void> {
  if (!push) return;
  const users = await adminUsers(tx, push.ownerOnly ? { ownerOnly: true } : {});
  for (const user of users) {
    await enqueuePush(
      tx,
      event,
      user.id,
      {
        app: 'ADMIN',
        body,
        category: push.category,
        data: { ...data, type: push.category },
        sound: push.sound,
        title,
        ...(push.timeSensitive ? { timeSensitive: true } : {}),
      },
      { dedupeSuffix: push.category },
    );
  }
}

const SLOT_STARTS = {
  AFTERNOON: '12:00',
  EVENING: '17:00',
  MORNING: '08:00',
} as const;

function londonMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return (values.get('hour') ?? 0) * 60 + (values.get('minute') ?? 0);
}

function minutesForTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function inQuietHours(now: Date, quiet: { end: string; start: string }): boolean {
  const current = londonMinutes(now);
  const start = minutesForTime(quiet.start);
  const end = minutesForTime(quiet.end);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function quietHoursEnd(now: Date, end: string): Date {
  const current = londonMinutes(now);
  const endMinutes = minutesForTime(end);
  const today = londonToday(now);
  const endDate = current < endMinutes ? today : addLondonDays(today, 1);
  return londonDateTimeToUtc(endDate, end);
}

async function bookingStartsWithinHours(tx: DbTx, bookingId: string | undefined, hours: number, now = new Date()): Promise<boolean> {
  if (!bookingId) return false;
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { moveDate: true, slot: true } });
  if (!booking) return false;
  const startsAt = londonDateTimeToUtc(fromDbDate(booking.moveDate), SLOT_STARTS[booking.slot]);
  return startsAt.getTime() <= now.getTime() + hours * 60 * 60_000;
}

async function driverPushDelay(tx: DbTx, event: ClaimedOutboxEvent, payload: EventPayload): Promise<Date | undefined> {
  const channels = channelsForEvent(event.type);
  const driverPush = channels?.driverPush;
  if (!driverPush?.quietHours || driverPush.timeSensitive) return undefined;
  if (driverPush.category === 'JOB_CHANGED' && await bookingStartsWithinHours(tx, payload.bookingId, 48)) return undefined;
  const settings = await getSetting('notifications').catch(() => ({
    driverQuietHours: { end: '07:00', start: '21:00' },
    newBookingRepeatUntilSeen: true,
  }));
  const now = new Date();
  return inQuietHours(now, settings.driverQuietHours) ? quietHoursEnd(now, settings.driverQuietHours.end) : undefined;
}

async function driverRecipients(tx: DbTx, payload: EventPayload, target: DriverPushTarget): Promise<string[]> {
  if (target === 'payload-driver') return payload.driverId ? [payload.driverId] : [];
  if (target === 'previous-driver') {
    if (payload.previousDriverId) return [payload.previousDriverId];
    if (!payload.bookingId) return [];
    const assignment = await tx.assignment.findFirst({
      orderBy: { respondedAt: 'desc' },
      select: { driverId: true },
      where: { bookingId: payload.bookingId, status: { in: ['ACCEPTED', 'WITHDRAWN'] } },
    });
    return assignment ? [assignment.driverId] : [];
  }
  if (!payload.bookingId) return [];
  if (target === 'offered') {
    const offers = await tx.assignment.findMany({
      select: { driverId: true },
      where: { bookingId: payload.bookingId, status: 'OFFERED' },
    });
    return offers.map((offer) => offer.driverId);
  }
  const booking = await tx.booking.findUnique({ where: { id: payload.bookingId }, select: { driverId: true } });
  return booking?.driverId ? [booking.driverId] : [];
}

async function enqueueDriverPush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  payload: EventPayload,
): Promise<void> {
  const channels = channelsForEvent(event.type);
  const driverPush = channels?.driverPush;
  if (!driverPush) return;
  const recipients = await driverRecipients(tx, payload, driverPush.target);
  const nextAttemptAt = await driverPushDelay(tx, event, payload);
  for (const userId of recipients) {
    await enqueuePush(
      tx,
      event,
      userId,
      {
        app: 'DRIVER',
        body,
        category: driverPush.category,
        data: { ...data, type: driverPush.category },
        sound: driverPush.sound,
        title,
        ...(driverPush.timeSensitive ? { timeSensitive: true } : {}),
      },
      { dedupeSuffix: driverPush.category, ...(nextAttemptAt ? { nextAttemptAt } : {}) },
    );
  }
}

async function expandDomainEvent(tx: DbTx, event: ClaimedOutboxEvent): Promise<void> {
  const channels = channelsForEvent(event.type);
  if (!channels) return;
  const payload = asPayload(event.payload);
  if (event.type === 'job.stage_changed' && payload.toStage !== 'EN_ROUTE_TO_PICKUP') return;
  let customer: { customerEmail: string; data: EmailTemplateData } | null = null;
  if (payload.bookingId) {
    customer = await bookingEmailData(tx, payload.bookingId);
  } else if (payload.manualQuoteId || payload.quoteId) {
    customer = await manualQuoteEmailData(tx, payload);
  } else if (payload.contactMessageId) {
    customer = await contactEmailData(tx, payload);
  }

  if (event.type === 'booking.driver_accepted' && payload.bookingId && customer) {
    const booking = await tx.booking.findUnique({
      where: { id: payload.bookingId },
      select: { driver: { select: { user: { select: { name: true } } } } },
    });
    const driverName = booking?.driver?.user.name;
    const firstName = driverName?.split(/\s+/)[0];
    if (firstName) customer = { ...customer, data: { ...customer.data, driverFirstName: firstName } };
  }

  const title = event.type === 'booking.confirmed'
    ? `New booking - ${customer?.data.amountPence ? formatGBP(customer.data.amountPence) : 'paid'}`
    : event.type.replaceAll('_', ' ').replaceAll('.', ' ');
  const body = payload.issue ?? customer?.data.routeLabel ?? 'Open Speedy Van admin.';

  if (channels.customerEmail && customer) {
    const refund = payload.refundId
      ? await tx.refund.findUnique({ where: { id: payload.refundId }, select: { amountPence: true } })
      : null;
    const extraCharge = payload.extraChargeId
      ? await tx.extraCharge.findUnique({
          where: { id: payload.extraChargeId },
          include: { booking: { select: { contactEmail: true } } },
        })
      : null;
    const extraPayToken = extraCharge ? await payLinkForExtraCharge(extraCharge) : null;
    await enqueueEmail(tx, event, channels.customerEmail as EmailTemplateKey, customer.customerEmail, {
      ...customer.data,
      ...(extraCharge ? { amountPence: extraCharge.amountPence, message: extraCharge.description } : {}),
      ...(extraPayToken ? { payUrl: `/pay/${encodeURIComponent(extraPayToken)}` } : {}),
      ...(typeof payload.refundPence === 'number' ? { refundPence: payload.refundPence } : {}),
      ...(refund ? { refundPence: refund.amountPence } : {}),
    });
  }
  if (channels.adminEmail) {
    const emails = await adminEmails(tx);
    await enqueueEmail(tx, event, channels.adminEmail as EmailTemplateKey, emails, customer?.data ?? { message: payload.issue ?? event.type });
  }
  if (channels.adminNotification) {
    await enqueueAdminNotification(
      tx,
      event,
      title,
      body,
      { ...payload, eventType: event.type },
      channels.adminNotificationOwnerOnly ? { ownerOnly: true } : {},
    );
  }
  if (channels.adminPush && (!channels.adminPush.onlyWithinHours || await bookingStartsWithinHours(tx, payload.bookingId, channels.adminPush.onlyWithinHours))) {
    await enqueueAdminPush(tx, event, title, body, { ...payload, category: channels.adminPush.category, eventType: event.type }, channels.adminPush);
  }
  if (channels.driverPush) {
    await enqueueDriverPush(tx, event, title, body, { ...payload, category: channels.driverPush.category, eventType: event.type }, payload);
  }
}

async function handleEvent(event: ClaimedOutboxEvent): Promise<void> {
  if (event.type === 'email.send') {
    await sendTransactionalEmail(event.payload as EmailSendPayload, event.id);
    return;
  }
  if (event.type === 'notification.create') {
    const payload = event.payload as { body: string; data?: Prisma.InputJsonValue; title: string; type: string; userId: string };
    await prisma.notification.create({
      data: {
        body: payload.body,
        data: payload.data ?? Prisma.JsonNull,
        title: payload.title,
        type: payload.type,
        userId: payload.userId,
      },
    });
    return;
  }
  if (event.type === 'push.send') {
    await sendPushOutbox(event.payload as PushSendPayload, event.id);
    return;
  }
  if (event.type === 'payment.refund') {
    const payload = asPayload(event.payload);
    if (!payload.refundId) throw new Error('refundId missing');
    await prisma.$transaction(async (tx) => runRefundOutbox(tx, payload.refundId as string));
    return;
  }
  await prisma.$transaction(async (tx) => expandDomainEvent(tx, event));
}

async function claimDueEvents(limit: number): Promise<ClaimedOutboxEvent[]> {
  return prisma.$transaction(async (tx) => {
    return tx.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE "OutboxEvent"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
  });
}

async function markDone(id: string): Promise<void> {
  await prisma.outboxEvent.update({ data: { lastError: null, processedAt: new Date(), status: 'DONE' }, where: { id } });
}

async function markFailed(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown outbox error';
  const attempts = event.attempts;
  if (attempts >= 6) {
    await prisma.outboxEvent.update({ data: { lastError: message, status: 'FAILED' }, where: { id: event.id } });
    await prisma.outboxEvent.create({
      data: {
        dedupeKey: `system.alert:outbox-failed:${event.id}`,
        payload: json({ issue: `Outbox event ${event.id} failed: ${message}` }),
        type: 'system.alert',
      },
    }).catch(() => undefined);
    return;
  }
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 360;
  await prisma.outboxEvent.update({
    data: {
      lastError: message,
      nextAttemptAt: new Date(Date.now() + minutes * 60_000),
      status: 'PENDING',
    },
    where: { id: event.id },
  });
}

export async function processOutboxBatch(limit = 25): Promise<{ done: number; failed: number }> {
  const events = await claimDueEvents(limit);
  let done = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await handleEvent(event);
      await markDone(event.id);
      done += 1;
    } catch (error) {
      await markFailed(event, error);
      failed += 1;
    }
  }
  return { done, failed };
}

export async function processOutboxEventNow(id: string): Promise<{ done: number; failed: number }> {
  const event = await prisma.outboxEvent.update({
    data: { attempts: { increment: 1 }, status: 'PROCESSING' },
    where: { id },
    select: { attempts: true, id: true, payload: true, type: true },
  });
  try {
    await handleEvent(event);
    await markDone(event.id);
    return { done: 1, failed: 0 };
  } catch (error) {
    await markFailed(event, error);
    return { done: 0, failed: 1 };
  }
}
